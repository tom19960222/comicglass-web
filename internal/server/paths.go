package server

import (
	"path/filepath"
	"strings"
)

func (s *Server) resolvePath(rel string) (string, error) {
	cleaned := filepath.Clean(rel)
	if cleaned == "." {
		return s.absoluteRoot, nil
	}

	candidate := filepath.Join(s.absoluteRoot, cleaned)
	withinRoot, err := s.isWithinRoot(candidate)
	if err != nil {
		return "", err
	}

	if !withinRoot {
		return "", errPathNotExist
	}

	return candidate, nil
}

func (s *Server) isWithinRoot(target string) (bool, error) {
	absTarget, err := filepath.Abs(target)
	if err != nil {
		return false, err
	}

	rel, err := filepath.Rel(s.absoluteRoot, absTarget)
	if err != nil {
		return false, err
	}

	if rel == "." {
		return true, nil
	}

	return !strings.HasPrefix(rel, ".."), nil
}

