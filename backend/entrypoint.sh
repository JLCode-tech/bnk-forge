#!/bin/bash
set -e

echo "================================================"
echo "BNK-Forge Backend Startup"
echo "================================================"

# Install user-supplied TLS CA certificates (e.g. corporate SSL inspection proxy).
# Corporate proxies re-sign outbound TLS (GitHub, Docker Hub, cloud APIs) with an
# internal CA that is not shipped in the public ca-certificates package. Mounting
# those CA files into /app/certs lets Forge trust them without baking them into
# the image or disabling certificate verification.
#
# The entrypoint runs as the non-root bnkforge user, so we cannot update the
# system-wide store. Instead we build a per-user bundle and export the standard
# environment variables that git, Python requests/urllib3, curl, Go binaries
# (Helm, OpenTofu), and the AWS CLI honor.
CUSTOM_CERT_DIR="/app/certs"
CUSTOM_BUNDLE="/home/bnkforge/.bnk-forge-ca-bundle.crt"
if [ -d "$CUSTOM_CERT_DIR" ]; then
    installed_count=0
    for cert in "$CUSTOM_CERT_DIR"/*.crt "$CUSTOM_CERT_DIR"/*.pem "$CUSTOM_CERT_DIR"/*.cer "$CUSTOM_CERT_DIR"/*.der; do
        [ -e "$cert" ] || continue
        installed_count=$((installed_count + 1))
    done
    if [ "$installed_count" -gt 0 ]; then
        echo "Installing $installed_count custom CA certificate(s) from $CUSTOM_CERT_DIR"
        # Start from the current system bundle, then append custom certs.
        cp /etc/ssl/certs/ca-certificates.crt "$CUSTOM_BUNDLE"
        for cert in "$CUSTOM_CERT_DIR"/*.crt "$CUSTOM_CERT_DIR"/*.pem "$CUSTOM_CERT_DIR"/*.cer "$CUSTOM_CERT_DIR"/*.der; do
            [ -e "$cert" ] || continue
            case "$cert" in
                *.der)
                    openssl x509 -inform DER -in "$cert" -out - >> "$CUSTOM_BUNDLE" 2>/dev/null || cat "$cert" >> "$CUSTOM_BUNDLE"
                    ;;
                *)
                    cat "$cert" >> "$CUSTOM_BUNDLE"
                    ;;
            esac
        done
        # Make the bundle available to common TLS consumers.
        export SSL_CERT_FILE="$CUSTOM_BUNDLE"
        export GIT_SSL_CAINFO="$CUSTOM_BUNDLE"
        # curl and Node/Go tooling may also honor these.
        export CURL_CA_BUNDLE="$CUSTOM_BUNDLE"
        export REQUESTS_CA_BUNDLE="$CUSTOM_BUNDLE"
    fi
fi

# Fix volume permissions on first run
# Docker volumes are created as root, but we run as bnkforge (uid 1000)
# The Makefile install target handles permissions, but we also check here
# in case the container is started directly
DIRS_TO_CHECK="/app/state /app/keys /app/agent-token /app/projects /app/workspaces /app/helm_charts /app/bfb-cache"
for dir in $DIRS_TO_CHECK; do
    if [ -d "$dir" ] && [ ! -w "$dir" ]; then
        echo "Warning: $dir is not writable by bnkforge user"
        echo "   Run: docker exec -u root <container> chown -R bnkforge:bnkforge $dir"
    fi
done

# Check for .env file (informational only)
if [ ! -f "/.env" ] && [ ! -f "/app/.env" ]; then
    echo "Note: No .env file found - using docker-compose environment variables"
fi

# S14-004: Skip DB migrations for celery workers (they don't need to run migrations)
# Only the backend (uvicorn) container should handle migrations
if echo "$@" | grep -q "celery"; then
    echo "Celery process detected - skipping database migrations"
    echo "Starting application..."
    exec "$@"
fi

# Database initialization/migration
echo ""
cd /app

# Normalize DATABASE_URL for Atlas (Go lib/pq requires sslmode=disable when server has no SSL)
ATLAS_URL="$DATABASE_URL"
if [[ "$ATLAS_URL" != *"sslmode="* ]] && [[ "$ATLAS_URL" == *"postgres"* ]]; then
    if [[ "$ATLAS_URL" == *"?"* ]]; then
        ATLAS_URL="${ATLAS_URL}&sslmode=disable"
    else
        ATLAS_URL="${ATLAS_URL}?sslmode=disable"
    fi
fi

if [ -f "/app/schema/schema.hcl" ] && command -v atlas >/dev/null 2>&1; then
    echo "Applying declarative database schema via Atlas..."
    atlas schema apply --url "$ATLAS_URL" --to "file:///app/schema/schema.hcl" --auto-approve
    if [ $? -ne 0 ]; then
        echo "Atlas schema apply failed"
        exit 1
    fi
else
    echo "Atlas or schema.hcl not found - falling back to init_db.py..."
    python init_db.py
    if [ $? -ne 0 ]; then
        echo "Database initialization failed"
        exit 1
    fi
fi

echo "Running idempotent database seeds..."
python -m seeds.seed_runner
if [ $? -ne 0 ]; then
    echo "Database seeding failed"
    exit 1
fi
echo "Database ready"

# Execute CMD from Dockerfile
echo ""
echo "Starting application..."
exec "$@"
