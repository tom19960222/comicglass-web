FROM golang:1.23 AS build

WORKDIR /app

COPY go.mod ./
# go.sum may not exist yet; go mod download will create it when needed.
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /app/bin/comicglass ./cmd/comicglass

FROM debian:12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/bin/comicglass /usr/local/bin/comicglass

ENV COMICGLASS_LIBRARY_ROOT=/app/books

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/comicglass"]