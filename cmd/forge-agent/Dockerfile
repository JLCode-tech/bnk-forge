# =============================================================================
# Stage 1: Build forge-agent static binary
# =============================================================================
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Copy dependency definition
COPY go.mod ./

# Copy source trees
COPY pkg/ pkg/
COPY cmd/forge-agent/ cmd/forge-agent/

# Compile static binary with optimizations
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-w -s" -o /forge-agent ./cmd/forge-agent

# =============================================================================
# Stage 2: Minimal runtime image
# =============================================================================
FROM alpine:3.20 AS runtime

RUN apk --no-cache add ca-certificates tzdata curl && \
    mkdir -p /var/lib/forge-agent/certs /var/lib/forge-agent/spool /var/run/tmm

WORKDIR /app

COPY --from=builder /forge-agent /usr/local/bin/forge-agent

VOLUME ["/var/lib/forge-agent", "/var/run/tmm"]

ENTRYPOINT ["/usr/local/bin/forge-agent"]
