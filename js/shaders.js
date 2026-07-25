import { ISO } from './math.js';

export const GROUND_FRAG = `
precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float u_day, u_dusk;
uniform vec3 u_seas;

void main(){
 vec4 base = texture2D(uSampler, vTextureCoord);
 vec3 col = base.rgb;
 col = mix(col * vec3(0.22, 0.30, 0.54), col, u_day);
 col = mix(col, col * vec3(1.34, 0.88, 0.66), u_dusk * 0.6);
 col *= u_seas;
 gl_FragColor = vec4(col, base.a);
}`;

export function createGroundFilter() {
  return new PIXI.Filter(null, GROUND_FRAG, {
    u_day: 1,
    u_dusk: 0,
    u_seas: [1, 1, 1]
  });
}
