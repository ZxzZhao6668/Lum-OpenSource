import {
  DepthTexture, FloatType, HalfFloatType, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial,
  UnsignedByteType, Vector2, Vector4, WebGLRenderTarget,
} from "three";
import type { PerspectiveCamera, WebGLRenderer } from "three";
import type { CameraFraming } from "./cameraDocument";

// Render linear scene color and depth together, then apply a thin-lens circle of confusion in sensor space.
export function createShootingLens(renderer: WebGLRenderer) {
  const colorType = renderer.extensions.has("EXT_color_buffer_float") ? HalfFloatType : UnsignedByteType;
  const buffer = new WebGLRenderTarget(1, 1, { type: colorType, depthTexture: new DepthTexture(1, 1, FloatType), samples: 0 });
  const material = new ShaderMaterial({
    uniforms: {
      imageMap: { value: buffer.texture }, depthMap: { value: buffer.depthTexture },
      viewport: { value: new Vector2() }, nearClip: { value: 0.05 }, farClip: { value: 500 },
      focusDistance: { value: 5 }, focalMeters: { value: 0.035 }, aperture: { value: 2.8 },
    },
    vertexShader: `varying vec2 imageUv;
      void main() { imageUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `uniform sampler2D imageMap, depthMap;
      uniform vec2 viewport;
      uniform float nearClip, farClip, focusDistance, focalMeters, aperture;
      varying vec2 imageUv;
      float depthAt(vec2 uv) {
        float d = texture2D(depthMap, uv).x;
        return nearClip * farClip / (farClip - d * (farClip - nearClip));
      }
      void main() {
        float depth = depthAt(imageUv);
        float coc = focalMeters * focalMeters / (aperture * max(0.01, focusDistance - focalMeters)) * abs(1.0 - focusDistance / depth);
        float radius = min(12.0, coc * max(viewport.x, viewport.y) / 0.072);
        vec3 color = texture2D(imageMap, imageUv).rgb;
        if (radius > 0.35) {
          float weights = 1.0;
          for (int i = 0; i < 12; i++) {
            float n = float(i) + 0.5;
            vec2 offset = vec2(cos(n * 2.39996), sin(n * 2.39996)) * sqrt(n / 12.0) * radius / viewport;
            vec2 uv = clamp(imageUv + offset, 0.0, 1.0);
            float weight = smoothstep(depth * 0.88, depth, depthAt(uv)) * 0.85 + 0.15;
            color += texture2D(imageMap, uv).rgb * weight; weights += weight;
          }
          color /= weights;
        }
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    depthTest: false, depthWrite: false,
  });
  const screen = new Scene();
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  screen.add(quad);
  const projector = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const viewport = new Vector4();
  function render(scene: Scene, camera: PerspectiveCamera, pose: CameraFraming) {
    renderer.getCurrentViewport(viewport);
    const width = Math.max(1, Math.round(viewport.z)), height = Math.max(1, Math.round(viewport.w));
    if (buffer.width !== width || buffer.height !== height) buffer.setSize(width, height);
    const previous = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(buffer);
      renderer.render(scene, camera);
    } finally { renderer.setRenderTarget(previous); }
    const u = material.uniforms;
    u.viewport!.value.set(width, height);
    u.nearClip!.value = camera.near; u.farClip!.value = camera.far;
    u.focusDistance!.value = Math.max(0.12, pose.focusDistance ?? 5);
    u.focalMeters!.value = pose.focalLength / 1000;
    u.aperture!.value = Math.max(0.7, pose.aperture ?? 2.8);
    renderer.render(screen, projector);
  }
  return { render, dispose() { buffer.dispose(); material.dispose(); quad.geometry.dispose(); } };
}

