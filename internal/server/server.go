package server

import (
	"path/filepath"

	"github.com/gin-gonic/gin"
)

type Server struct {
	engine       *gin.Engine
	libraryRoot  string
	absoluteRoot string
	allowedExts  map[string]struct{}
}

func New() (*Server, error) {
	libraryRoot := determineLibraryRoot()
	absoluteRoot, err := filepath.Abs(libraryRoot)
	if err != nil {
		return nil, err
	}

	indexTemplate, err := newIndexTemplate()
	if err != nil {
		return nil, err
	}

	engine := gin.New()
	engine.Use(gin.Recovery())
	engine.SetHTMLTemplate(indexTemplate)

	srv := &Server{
		engine:       engine,
		libraryRoot:  libraryRoot,
		absoluteRoot: absoluteRoot,
		allowedExts:  defaultAllowedExtSet(),
	}

	engine.GET("/", srv.handleIndex)
	engine.NoRoute(srv.serveStaticFile)

	return srv, nil
}

func (s *Server) Run(addr string) error {
	return s.engine.Run(addr)
}
