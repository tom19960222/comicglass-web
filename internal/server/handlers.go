package server

import (
	"errors"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

func (s *Server) handleIndex(c *gin.Context) {
	requestedPath := strings.TrimSpace(c.Query("path"))
	if requestedPath == "" {
		requestedPath = "."
	}

	absolutePath, err := s.resolvePath(requestedPath)
	if err != nil {
		s.respondError(c, err)
		return
	}

	info, err := os.Stat(absolutePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			s.respondError(c, errPathNotExist)
			return
		}

		s.respondError(c, err)
		return
	}

	if !info.IsDir() {
		s.respondError(c, errPathNotExist)
		return
	}

	entries, err := s.listEntries(absolutePath)
	if err != nil {
		s.respondError(c, err)
		return
	}

	displayPath := "./"
	if requestedPath != "." {
		displayPath = requestedPath
	}

	data := indexPageData{
		Title:     displayPath,
		PathLabel: displayPath,
		Entries:   s.buildEntryViews(entries),
	}

	c.HTML(http.StatusOK, "index", data)
}

func (s *Server) serveStaticFile(c *gin.Context) {
	requested := strings.TrimPrefix(c.Request.URL.Path, "/")
	if strings.TrimSpace(requested) == "" {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}

	absolutePath, err := s.resolvePath(requested)
	if err != nil {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}

	info, err := os.Stat(absolutePath)
	if err != nil || info.IsDir() {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}

	c.File(absolutePath)
}

func (s *Server) buildEntryViews(entries []fileEntry) []entryView {
	views := make([]entryView, 0, len(entries))
	for _, entry := range entries {
		view := entryView{
			Name:       entry.Name,
			IsDir:      entry.IsDir,
			ModifyTime: entry.ModifyTime,
			Size:       entry.Size,
		}

		if entry.IsDir {
			view.DirectoryHref = "?path=" + url.QueryEscape(entry.RelativePath)
		} else {
			view.FileHref = buildFileHref(entry.RelativePath)
		}

		views = append(views, view)
	}

	return views
}

func buildFileHref(relative string) string {
	clean := strings.TrimPrefix(filepath.ToSlash(relative), "./")
	if clean == "" {
		return "/"
	}

	parts := strings.Split(clean, "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}

	return "/" + strings.Join(parts, "/")
}

func (s *Server) respondError(c *gin.Context, err error) {
	if err == nil {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}

	var httpErr *httpError
	if errors.As(err, &httpErr) {
		if httpErr.Status >= http.StatusInternalServerError {
			log.Printf("server error: %v", err)
		}

		c.String(httpErr.Status, httpErr.Message)
		return
	}

	log.Printf("unexpected error: %v", err)
	c.String(http.StatusInternalServerError, "internal server error")
}
