import * as THREE from 'three';

const MAX = 180;
const GRAVITY = 9.8;
const HIDDEN_Y = -10; // dead particles are parked far below the table

/** Pooled friction sparks: one Points object, a fixed number of particles, recycled in a ring. */
export class Sparks {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.col = new Float32Array(MAX * 3);
    this.next = 0;
    for (let i = 0; i < MAX; i++) this.pos[i * 3 + 1] = HIDDEN_Y;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({
      vertexColors: true,
      size: 0.008,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /** Throw `count` sparks from `p`, upward and outward. */
  emit(p, count, power = 1) {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y + 0.004;
      this.pos[i * 3 + 2] = p.z;
      this.vel[i * 3] = (Math.random() - 0.5) * 1.2 * power;
      this.vel[i * 3 + 1] = (0.5 + Math.random()) * power;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 1.2 * power;
      this.life[i] = 0.2 + Math.random() * 0.25;
      // Friction sparks are orange or violet, like the haunted set.
      const c = Math.random() < 0.6 ? [1.0, 0.54, 0.16] : [0.7, 0.42, 1.0];
      this.col[i * 3] = c[0];
      this.col[i * 3 + 1] = c[1];
      this.col[i * 3 + 2] = c[2];
    }
  }

  update(dt) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= GRAVITY * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = HIDDEN_Y;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
