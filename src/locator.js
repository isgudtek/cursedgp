import * as THREE from 'three';

/**
 * "Where is my car?": a yellow pillow-shaped arrow hanging in mid air over your car, pointing down at it, with a pulsing
 * ring on the deck around it. It is drawn over everything (no depth test), so banners, trees and monsters never hide it,
 * and its size follows the camera distance, so it reads the same in the overview, on a TV camera or in the free camera.
 * It shows through the countdown and the first seconds of the race, and on demand (the I key, or the locate button).
 */
const COLOR = 0xffd400;
const SIZE = 0.07; // arrow height as a share of the camera distance
const FADE = 0.25; // s to fade in or out

/** A soft, rounded arrow pointing down: tip at y = 0, top at y = 1, about 0.6 wide, puffed up like a pillow. */
function pillowArrowGeometry() {
  const s = new THREE.Shape();
  const shaftW = 0.2;
  const headW = 0.6;
  const headTop = 0.46;
  s.moveTo(-shaftW / 2, 1);
  s.lineTo(shaftW / 2, 1);
  s.lineTo(shaftW / 2, headTop);
  s.lineTo(headW / 2, headTop);
  s.lineTo(0, 0);
  s.lineTo(-headW / 2, headTop);
  s.lineTo(-shaftW / 2, headTop);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 0.1,
    bevelEnabled: true,
    bevelThickness: 0.11,
    bevelSize: 0.09,
    bevelSegments: 6,
    curveSegments: 8,
  });
  g.center(); // centred on its own middle, so the tip sits at the bottom of the bounds
  const box = new THREE.Box3().setFromBufferAttribute(g.attributes.position);
  g.translate(0, -box.min.y, 0); // tip at y = 0, top at y = 1
  return g;
}

export class CarLocator {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'car-locator';
    const mat = (opacity) => new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
    const edge = new THREE.MeshBasicMaterial({ color: 0x1a1400, transparent: true, opacity: 1, depthTest: false, depthWrite: false, fog: false, toneMapped: false, side: THREE.BackSide });
    const geo = pillowArrowGeometry();
    this.arrow = new THREE.Group();
    this.body = new THREE.Mesh(geo, mat(1));
    // A dark rim one size up behind the yellow keeps it readable on a bright sky or a lit billboard.
    this.rim = new THREE.Mesh(geo, edge);
    this.rim.scale.setScalar(1.1);
    this.rim.position.y = -0.02;
    this.body.renderOrder = 999;
    this.rim.renderOrder = 998;
    this.arrow.add(this.rim, this.body);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.78, 1, 40).rotateX(-Math.PI / 2), mat(0.8));
    this.ring.renderOrder = 997;
    this.group.add(this.arrow, this.ring);
    this.group.visible = false;
    scene.add(this.group);
    this.t = 0; // seconds of showing left
    this.alpha = 0;
    this.clock = 0;
  }

  /** Show for `seconds` (at least what is left already). */
  flash(seconds = 3) {
    this.t = Math.max(this.t, seconds);
  }

  hide() {
    this.t = 0;
  }

  get showing() {
    return this.t > 0;
  }

  /**
   * @param {number} dt
   * @param {{ position: THREE.Vector3, mesh: THREE.Object3D }} car the car to point at
   * @param {THREE.Camera} camera
   * @param {boolean} allowed false hides it at once (chase view, replay, menus)
   */
  update(dt, car, camera, allowed) {
    this.clock += dt;
    this.t = Math.max(0, this.t - dt);
    const want = allowed && this.t > 0 && car.mesh.visible ? 1 : 0;
    this.alpha = allowed ? this.alpha + Math.sign(want - this.alpha) * Math.min(Math.abs(want - this.alpha), dt / FADE) : 0;
    this.group.visible = this.alpha > 0.01;
    if (!this.group.visible) return;
    const p = car.mesh.position;
    camera.getWorldPosition(_cam);
    const d = _cam.distanceTo(p);
    const s = d * SIZE;
    const bob = Math.sin(this.clock * 5) * 0.12 * s;
    this.arrow.position.set(p.x, p.y + 0.03 + s * 0.35 + bob, p.z);
    this.arrow.scale.setScalar(s);
    // The arrow turns slowly so it always looks round, whatever the camera.
    this.arrow.rotation.y = this.clock * 1.5;
    const pulse = (this.clock * 1.2) % 1;
    this.ring.position.set(p.x, p.y + 0.002, p.z);
    this.ring.scale.setScalar(s * (0.25 + 0.35 * pulse));
    this.body.material.opacity = this.alpha;
    this.rim.material.opacity = this.alpha;
    this.ring.material.opacity = this.alpha * 0.8 * (1 - pulse);
  }
}

const _cam = new THREE.Vector3();
