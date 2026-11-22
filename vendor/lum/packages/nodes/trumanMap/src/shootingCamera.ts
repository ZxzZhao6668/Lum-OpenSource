import { MathUtils, Vector3 } from "three";
import type { CameraFraming, CameraTracking } from "./cameraDocument";

export type ShootingCameraSettings = {
  method: "固定" | "云台" | "漂浮" | "手持" | "跑拍" | "航拍" | "穿越";
  speed: number;
  shake: number;
  height: number;
  aperture: number;
  focalLength: number;
  format: "16:9" | "9:16" | "1:1" | "21:9";
  follow: boolean;
  random?: number;
};
type Point = CameraFraming["position"];
type RigEnvironment = {
  ground: (x: number, z: number) => number;
  pick: (x: number, y: number) => CameraTracking | undefined;
  resolve: (subject: CameraTracking) => Point | undefined;
};
const profiles: Record<ShootingCameraSettings["method"], { travel: number; damping: number; bob: number; frequency: number; flight: boolean }> = {
  固定: { travel: 0, damping: 30, bob: 0, frequency: 1, flight: false },
  云台: { travel: 1, damping: 8, bob: 0.08, frequency: 0.8, flight: false },
  漂浮: { travel: 0.85, damping: 2.8, bob: 0.4, frequency: 0.5, flight: true },
  手持: { travel: 1, damping: 14, bob: 0.7, frequency: 1.7, flight: false },
  跑拍: { travel: 2.3, damping: 13, bob: 1.4, frequency: 2.6, flight: false },
  航拍: { travel: 3.5, damping: 3.4, bob: 0.14, frequency: 0.65, flight: true },
  穿越: { travel: 4.5, damping: 14, bob: 0.45, frequency: 1.3, flight: true },
};
function point(value: Vector3): Point { return { x: value.x, y: value.y, z: value.z }; }

// 临界阻尼的解析积分。改目标时沿用当前速度，松手和反向均连续。
function dampedAxis() {
  let value = 0, velocity = 0;
  return {
    get value() { return value; },
    reset(start: number) { value = start; velocity = 0; },
    step(target: number, dt: number, response: number) {
      if (!dt || value === target && velocity === 0) return value;
      const offset = value - target;
      const slope = velocity + response * offset;
      const decay = Math.exp(-response * dt);
      value = target + (offset + slope * dt) * decay;
      velocity = (velocity - response * slope * dt) * decay;
      if (Math.abs(value - target) < 0.00001 && Math.abs(velocity) < 0.0001) {
        value = target; velocity = 0;
      }
      return value;
    },
  };
}

export function shootingFrameRect(width: number, height: number, aspect: number) {
  const frameWidth = Math.min(width, height * aspect);
  const frameHeight = frameWidth / aspect;
  return { x: (width - frameWidth) / 2, y: (height - frameHeight) / 2, width: frameWidth, height: frameHeight };
}

export function createShootingCamera(canvas: HTMLCanvasElement, environment: RigEnvironment) {
  let settings: ShootingCameraSettings | undefined;
  let playback: CameraFraming | null = null;
  let paused = false, enabled = true, phase = 0, yaw = 0, pitch = 0, aimYaw = 0, aimPitch = 0, focusDistance = 5;
  let drag: { id: number; x: number; y: number; travel: number } | undefined;
  let candidate: CameraTracking | undefined, subject: CameraTracking | undefined;
  let lastSubject: Vector3 | undefined;
  let pose: CameraFraming | undefined;
  const position = new Vector3(), velocity = new Vector3(), movement = new Vector3();
  const direction = new Vector3(), side = new Vector3(), destination = new Vector3(), eye = new Vector3();
  const keys = new Set<string>();
  // 高度目标独立于世界坐标，航拍、跟拍和既有机位都能相对当前位置升降。
  let heightTarget = 0, tapTravel = 0;
  const rigHeight = dampedAxis(), logFocal = dampedAxis();
  const liftRate = 1.5; // 米/秒
  function holdHeight(code: "KeyQ" | "KeyE") {
    if (!allowed() || keys.has(code)) return;
    keys.add(code);
    tapTravel = 0;
    if (keys.has("KeyQ") && keys.has("KeyE")) return;
    // 轻点保持原来的 10 厘米精度。长按时这段距离计入匀速行程。
    tapTravel = 0.1;
    heightTarget = MathUtils.clamp(heightTarget + (code === "KeyE" ? tapTravel : -tapTravel), 0.25, 100);
  }
  function advanceHeight(dt: number) {
    const lift = Number(keys.has("KeyE")) - Number(keys.has("KeyQ"));
    if (lift) {
      const travel = liftRate * dt;
      const prepaid = Math.min(travel, tapTravel);
      tapTravel -= prepaid;
      heightTarget = MathUtils.clamp(heightTarget + lift * (travel - prepaid), 0.25, 100);
    }
    const previous = rigHeight.value;
    position.y += rigHeight.step(heightTarget, dt, 24) - previous;
  }
  const keyboard = canvas.closest<HTMLElement>(".sceneStudio") ?? canvas;
  const controller = new AbortController();
  const listener = { capture: true, signal: controller.signal };
  const allowed = () => !!settings && enabled && !paused && !playback;
  function stopInput() {
    keys.clear();
    tapTravel = 0;
    velocity.set(0, 0, 0);
    if (drag && canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id);
    drag = undefined;
  }
  function centerSubject() {
    const rect = canvas.getBoundingClientRect();
    return environment.pick(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }
  function focus() {
    subject = candidate ?? centerSubject();
    const target = subject && environment.resolve(subject);
    lastSubject = target ? new Vector3(target.x, target.y, target.z) : undefined;
    if (!target) subject = undefined;
    return !!target;
  }
  function clearFocus() {
    subject = undefined;
    lastSubject = undefined;
    if (pose) {
      const axis = direction.set(pose.target.x, pose.target.y, pose.target.z).sub(eye.set(pose.position.x, pose.position.y, pose.position.z)).normalize();
      aimYaw = yaw = Math.atan2(axis.x, -axis.z);
      aimPitch = pitch = Math.asin(MathUtils.clamp(axis.y, -1, 1));
    }
  }
  function step(delta: number) {
    if (!settings || paused || playback) return;
    const dt = Math.max(0, Math.min(delta, 0.1));
    phase += dt;
    const profile = profiles[settings.method];
    const blend = 1 - Math.exp(-dt * profile.damping);
    yaw = MathUtils.lerp(yaw, aimYaw, blend);
    pitch = MathUtils.lerp(pitch, aimPitch, blend);
    const forward = Number(keys.has("KeyW")) - Number(keys.has("KeyS"));
    const right = Number(keys.has("KeyD")) - Number(keys.has("KeyA"));
    const incline = profile.flight ? pitch : 0;
    movement.set(Math.sin(yaw) * Math.cos(incline), Math.sin(incline), -Math.cos(yaw) * Math.cos(incline)).multiplyScalar(forward);
    side.set(Math.cos(yaw), 0, Math.sin(yaw));
    movement.addScaledVector(side, right).normalize().multiplyScalar(settings.speed * profile.travel);
    velocity.lerp(movement, blend);
    position.addScaledVector(velocity, dt).clampScalar(-9995, 9995);
    const lensDt = MathUtils.clamp(delta, 0, 0.2);
    advanceHeight(lensDt);
    const floor = environment.ground(position.x, position.z);
    if (!profile.flight && velocity.lengthSq() > 0.0001) position.y = MathUtils.lerp(position.y, floor + rigHeight.value, blend);
    position.y = Math.max(floor + 0.08, position.y);
    const target = subject && environment.resolve(subject);
    if (target) {
      destination.set(target.x, target.y, target.z);
      if (settings.follow && lastSubject) position.add(destination).sub(lastSubject).clampScalar(-9995, 9995);
      (lastSubject ??= new Vector3()).copy(destination);
      const aim = destination.sub(position);
      if (aim.lengthSq() > 0.000001) {
        const heading = Math.atan2(aim.x, -aim.z);
        aimYaw = yaw + Math.atan2(Math.sin(heading - yaw), Math.cos(heading - yaw));
        aimPitch = Math.asin(MathUtils.clamp(aim.normalize().y, -1, 1));
      }
    } else if (subject) clearFocus();
    const t = phase * Math.PI * 2 * profile.frequency;
    const variation = MathUtils.clamp(settings.random ?? 0.3, 0, 1);
    const amplitude = MathUtils.clamp(settings.shake, 0, 1) * (0.18 + profile.bob);
    const sway = amplitude * (Math.sin(t) + variation * Math.sin(t * 1.73));
    const vertical = amplitude * Math.sin(t * 2.03 + 0.4);
    eye.copy(position).addScaledVector(side, sway * 0.032);
    eye.y += vertical * 0.035;
    const a = yaw + sway * 0.006, b = pitch + vertical * 0.005;
    direction.set(Math.sin(a) * Math.cos(b), Math.sin(b), -Math.cos(a) * Math.cos(b));
    const measurement = target ?? (candidate && environment.resolve(candidate));
    if (measurement) focusDistance = MathUtils.clamp(destination.set(measurement.x, measurement.y, measurement.z).sub(eye).dot(direction), 0.12, 10000);
    destination.copy(eye).addScaledVector(direction, Math.max(0.12, Math.min(100, focusDistance))).clampScalar(-9999, 9999);
    const targetLog = Math.log(settings.focalLength);
    const currentLog = logFocal.step(targetLog, lensDt, 22);
    const focalLength = currentLog === targetLog ? settings.focalLength : MathUtils.clamp(Math.exp(currentLog), 12, 200);
    pose = { position: point(eye), target: point(destination), focalLength, roll: sway * 0.75, aperture: settings.aperture, focusDistance };
  }
  function begin(value: ShootingCameraSettings, framing: CameraFraming, keepPose: boolean) {
    stopInput();
    heightTarget = value.height;
    rigHeight.reset(value.height);
    logFocal.reset(Math.log(value.focalLength));
    settings = { ...value };
    playback = null; candidate = undefined; subject = undefined; lastSubject = undefined;
    paused = false; enabled = true; phase = 0;
    position.set(framing.position.x, framing.position.y, framing.position.z);
    if (!keepPose) position.y = environment.ground(position.x, position.z) + value.height;
    const target = destination.set(framing.target.x, framing.target.y, framing.target.z);
    if (!keepPose) {
      // Orbit 编辑的中心常在地面；肩扛取景默认对着该位置的眼高。
      target.y = Math.max(target.y, environment.ground(target.x, target.z) + Math.min(value.height, 1.6));
    }
    const axis = direction.copy(target).sub(position);
    focusDistance = MathUtils.clamp(framing.focusDistance ?? axis.length(), 0.12, 10000);
    axis.normalize();
    aimYaw = yaw = Math.atan2(axis.x, -axis.z);
    aimPitch = pitch = MathUtils.clamp(Math.asin(axis.y), keepPose ? -1.55 : -0.23, keepPose ? 1.55 : 0.23);
    step(0);
  }
  function update(value: ShootingCameraSettings) {
    if (!settings) return;
    if (value.height !== settings.height || value.method !== settings.method) heightTarget = value.height;
    const follow = value.follow && !settings.follow;
    settings = { ...value };
    if (follow && !subject) focus();
    step(0);
  }
  function end() { stopInput(); settings = undefined; pose = undefined; subject = undefined; candidate = undefined; playback = null; }
  function intercept(event: Event) { event.preventDefault(); event.stopImmediatePropagation(); }
  canvas.addEventListener("pointerdown", event => {
    if (!settings) return;
    intercept(event);
    if (!allowed() || !event.isPrimary || ![0, 2].includes(event.button)) return;
    keyboard.focus({ preventScroll: true });
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, travel: 0 };
    canvas.setPointerCapture(event.pointerId);
  }, listener);
  canvas.addEventListener("pointermove", event => {
    if (!settings) return;
    intercept(event);
    if (!drag || drag.id !== event.pointerId || !allowed()) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    drag.x = event.clientX; drag.y = event.clientY; drag.travel += Math.abs(dx) + Math.abs(dy);
    if (drag.travel <= 3 || subject) return;
    aimYaw += dx * 0.003;
    aimPitch = MathUtils.clamp(aimPitch - dy * 0.003, -1.54, 1.54);
  }, listener);
  canvas.addEventListener("pointerup", event => {
    if (!settings) return;
    intercept(event);
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.travel <= 3 && allowed() && event.button === 0) {
      candidate = environment.pick(event.clientX, event.clientY);
      if (subject || settings.follow) focus();
    }
    drag = undefined;
  }, listener);
  canvas.addEventListener("lostpointercapture", () => { drag = undefined; }, listener);
  canvas.addEventListener("contextmenu", event => { if (settings) intercept(event); }, listener);
  canvas.addEventListener("dblclick", event => { if (settings) intercept(event); }, listener);
  keyboard.addEventListener("keydown", event => {
    if (!allowed() || event.isComposing || event.altKey || event.metaKey || event.ctrlKey || !(event.target instanceof Element) || event.target.closest("input,textarea,select,[contenteditable=true]") || !["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) return;
    intercept(event);
    keys.add(event.code);
  }, listener);
  canvas.ownerDocument.defaultView?.addEventListener("keyup", event => { keys.delete(event.code); }, listener);
  canvas.ownerDocument.defaultView?.addEventListener("blur", stopInput, listener);
  canvas.ownerDocument.addEventListener("visibilitychange", () => { if (canvas.ownerDocument.hidden) stopInput(); }, listener);
  return { begin, update, end, focus, clearFocus, step, holdHeight,
    get height() { return heightTarget; },
    get active() { return !!settings; },
    get locked() { return !!subject; },
    get subjectId() { return subject?.objectId; },
    get aspect() { const [w, h] = (settings?.format ?? "16:9").split(":").map(Number); return w! / h!; },
    get pose() { return playback ?? pose; },
    setPaused(value: boolean) { paused = value; if (value) stopInput(); },
    setInputEnabled(value: boolean) { enabled = value; if (!value) stopInput(); },
    setPlayback(value: CameraFraming | null) { playback = value; if (value) stopInput(); },
    dispose() { end(); controller.abort(); },
  };
}

