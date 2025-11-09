package server

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

var defaultExtensions = []string{
	"gif",
	"png",
	"jpg",
	"jpeg",
	"tif",
	"tiff",
	"zip",
	"rar",
	"cbz",
	"cbr",
	"bmp",
	"pdf",
	"cgt",
}

type fileEntry struct {
	Name         string
	RelativePath string
	ModifyTime   int64
	Size         int64
	IsDir        bool
}

func determineLibraryRoot() string {
	if root, ok := os.LookupEnv("COMICGLASS_LIBRARY_ROOT"); ok && strings.TrimSpace(root) != "" {
		return root
	}

	return filepath.Join(".", "books")
}

func defaultAllowedExtSet() map[string]struct{} {
	set := make(map[string]struct{}, len(defaultExtensions))
	for _, ext := range defaultExtensions {
		set[ext] = struct{}{}
	}

	return set
}

func (s *Server) listEntries(absDir string) ([]fileEntry, error) {
	dirEntries, err := os.ReadDir(absDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, errPathNotExist
		}

		return nil, err
	}

	entries := make([]fileEntry, 0, len(dirEntries))
	for _, entry := range dirEntries {
		info, err := entry.Info()
		if err != nil {
			return nil, err
		}

		absPath := filepath.Join(absDir, entry.Name())
		relative, err := filepath.Rel(s.absoluteRoot, absPath)
		if err != nil {
			return nil, err
		}

		relative = filepath.ToSlash(relative)
		if entry.IsDir() {
			entries = append(entries, fileEntry{
				Name:         entry.Name(),
				RelativePath: relative,
				ModifyTime:   info.ModTime().Unix(),
				IsDir:        true,
			})

			continue
		}

		if !info.Mode().IsRegular() {
			continue
		}

		if !s.isAllowedExtension(entry.Name()) {
			continue
		}

		entries = append(entries, fileEntry{
			Name:         entry.Name(),
			RelativePath: relative,
			ModifyTime:   info.ModTime().Unix(),
			Size:         info.Size(),
			IsDir:        false,
		})
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}

		left := strings.ToLower(entries[i].Name)
		right := strings.ToLower(entries[j].Name)

		return left < right
	})

	return entries, nil
}

func (s *Server) isAllowedExtension(name string) bool {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(name), "."))
	_, ok := s.allowedExts[ext]

	return ok
}

