package server

import "net/http"

type httpError struct {
	Status  int
	Message string
}

func (e *httpError) Error() string {
	return e.Message
}

var errPathNotExist = &httpError{
	Status:  http.StatusBadRequest,
	Message: "Path does not exist",
}

