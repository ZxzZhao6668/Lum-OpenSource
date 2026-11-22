import { createNodeConfig } from "@lum/nodes-scaffold";
import { compressNode } from "./nodeCompression.ts";
import { compactAnimationData } from "./animationDataCompaction.ts";

const config = createNodeConfig({
  name: "trumanMap",
  displayName: "白模预演TrumanMap",
  author: "Lum",
  github: "https://github.com/ZxzZhao6668/Lum-OpenSource/tree/main/vendor/lum/packages/nodes/trumanMap",
}, import.meta.url);

export default { ...config, plugins: [compactAnimationData(), ...config.plugins ?? [], compressNode()] };
