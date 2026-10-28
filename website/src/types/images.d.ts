// Gatsby's webpack config resolves image imports to their public URL.
declare module "*.jpg" {
  const src: string
  export default src
}
declare module "*.png" {
  const src: string
  export default src
}
