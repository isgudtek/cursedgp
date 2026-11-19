import * as THREE from 'three';

/**
 * Cockpit "TV": a small screen showing the scene from one slot car's point of view.
 * The scene is rendered into a render target, read back and drawn onto a 2D canvas.
 */

const W = 256;
const H = 144;

const _eye = new THREE.Vector3();
const _at = new THREE.Vector3();

export class CockpitTV {
  /**
   * @param {string} label
   * @param {string} accent CSS colour for the frame and label
   * @param {HTMLElement} parent element the screen is added to (the right-hand panel)
   */
  constructor(label, accent, parent) {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      display: 'none',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '4px',
    });
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    Object.assign(this.canvas.style, {
      width: '152px', // displayed smaller than the W x H render size
      height: '86px',
      borderRadius: '10px',
      border: `2px solid ${accent}`,
      boxShadow: `0 0 18px ${accent}55`,
      background: '#06070b',
    });
    this.ctx = this.canvas.getContext('2d');
    this.img = this.ctx.createImageData(W, H);
    this.buf = new Uint8Array(W * H * 4);
    this.rt = new THREE.WebGLRenderTarget(W, H);
    this.cam = new THREE.PerspectiveCamera(72, W / H, 0.004, 20);

    const tag = document.createElement('div');
    tag.textContent = label;
    Object.assign(tag.style, { font: '700 11px monospace', letterSpacing: '.2em', color: accent });
    this.el.append(this.canvas, tag);
    parent.appendChild(this.el);
    this.shown = false;
  }

  show(on) {
    if (on === this.shown) return;
    this.shown = on;
    this.el.style.display = on ? 'flex' : 'none';
  }

  /** Render the scene from the car's cabin, looking along its nose. */
  update(renderer, scene, car) {
    car.mesh.updateMatrixWorld(true);
    this.cam.position.copy(_eye.set(0, 0.034, 0.02));
    car.mesh.localToWorld(this.cam.position);
    _at.set(0, 0.02, -0.4);
    car.mesh.localToWorld(_at);
    this.cam.lookAt(_at);
    this.cam.updateMatrixWorld(true);

    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.render(scene, this.cam);
    renderer.readRenderTargetPixels(this.rt, 0, 0, W, H, this.buf);
    renderer.setRenderTarget(prev);

    // Render targets read back bottom-up; flip the rows onto the canvas.
    const row = W * 4;
    const d = this.img.data;
    for (let y = 0; y < H; y++) d.set(this.buf.subarray((H - 1 - y) * row, (H - y) * row), y * row);
    this.ctx.putImageData(this.img, 0, 0);
  }
}
