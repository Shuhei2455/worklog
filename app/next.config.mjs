/** @type {import('next').NextConfig} */
const nextConfig = {
  // 職場VMへ docker save/load で持ち込む前提。standalone で成果物を小さくする
  output: "standalone",
};
export default nextConfig;
