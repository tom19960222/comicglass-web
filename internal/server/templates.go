package server

import (
	"html/template"
)

const indexTemplate = `<!DOCTYPE html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <title>{{.Title}}</title>
  </head>
  <body>
    <h3>{{.PathLabel}}</h3>
    <ul>
      {{range .Entries}}
        {{if .IsDir}}
          <li type="circle">
            <a href="{{.DirectoryHref}}" bookdate="{{.ModifyTime}}">{{.Name}}</a>
          </li>
        {{else}}
          <li>
            <a href="{{.FileHref}}" booktitle="{{.Name}}" booksize="{{.Size}}" bookdate="{{.ModifyTime}}">{{.Name}}</a>
          </li>
        {{end}}
      {{end}}
    </ul>
  </body>
</html>`

type indexPageData struct {
	Title     string
	PathLabel string
	Entries   []entryView
}

type entryView struct {
	Name          string
	IsDir         bool
	DirectoryHref string
	FileHref      string
	ModifyTime    int64
	Size          int64
}

func newIndexTemplate() (*template.Template, error) {
	return template.New("index").Parse(indexTemplate)
}

