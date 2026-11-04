/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

// The markdown vite plugin turns .md imports into rendered HTML strings.
declare module '*.md' {
  const html: string
  export default html
}
