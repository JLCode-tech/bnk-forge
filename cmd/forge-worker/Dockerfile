# Multi-stage build for forge-worker
FROM golang:1.24-alpine AS builder

WORKDIR /src
COPY go.mod ./
COPY pkg/ pkg/
COPY cmd/ cmd/

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /forge-worker ./cmd/forge-worker

FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata curl
COPY --from=builder /forge-worker /usr/local/bin/forge-worker

USER nobody
ENTRYPOINT ["/usr/local/bin/forge-worker"]
