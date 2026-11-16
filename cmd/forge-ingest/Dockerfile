# =============================================================================
# Stage 1: Build forge-ingest binary
# =============================================================================
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Copy dependency definition
COPY go.mod ./

# Copy source trees
COPY pkg/ pkg/
COPY cmd/forge-ingest/ cmd/forge-ingest/

# Compile static binary with optimizations
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-w -s" -o /forge-ingest ./cmd/forge-ingest

# =============================================================================
# Stage 2: Minimal runtime image
# =============================================================================
FROM alpine:3.20 AS runtime

RUN apk --no-cache add ca-certificates tzdata curl && \
    addgroup -S forge && adduser -S forge -G forge -h /app

WORKDIR /app

COPY --from=builder /forge-ingest /usr/local/bin/forge-ingest

# Expose unified ingest gateway port
EXPOSE 17543

USER forge

ENTRYPOINT ["/usr/local/bin/forge-ingest"]
