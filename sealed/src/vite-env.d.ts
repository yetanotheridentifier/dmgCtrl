/// <reference types="vite/client" />

// The markdown vite plugin turns .md imports into rendered HTML strings.
declare module '*.md' {
  const html: string
  export default html
}
