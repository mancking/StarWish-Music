/// <reference types="vite/client" />

/** 移动端音源种子用 `?raw` 内联 sources/*.js，这里声明该模块形状。 */
declare module '*?raw' {
  const content: string
  export default content
}
