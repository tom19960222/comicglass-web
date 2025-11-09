package main

import (
	"log"

	"github.com/gin-gonic/gin"

	"comicglass-web/internal/server"
)

const listenAddr = "0.0.0.0:3000"

func main() {
	gin.SetMode(gin.ReleaseMode)

	srv, err := server.New()
	if err != nil {
		log.Fatalf("failed to initialize server: %v", err)
	}

	if err := srv.Run(listenAddr); err != nil {
		log.Fatalf("failed to start server: %v", err)
	}
}

