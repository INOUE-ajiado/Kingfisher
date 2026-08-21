/**
 * WebGPU High-Performance Renderer for Kingfisher
 * Provides WGSL Fragment Shader execution for Pure-White Alpha Translucency
 * and Multi-texture Light Table Layer Blending.
 */

export class WebGPURenderer {
  private device: any = null;
  private context: any = null;
  private pipeline: any = null;
  private isSupported: boolean = false;

  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    const nav = navigator as any;
    if (!nav.gpu) {
      console.warn('WebGPU is not supported on this browser. Falling back to Canvas2D/WebGL.');
      return false;
    }

    try {
      const adapter = await nav.gpu.requestAdapter();
      if (!adapter) return false;

      this.device = await adapter.requestDevice();
      this.context = canvas.getContext('webgpu');

      if (!this.context) return false;

      const format = nav.gpu.getPreferredCanvasFormat();
      this.context.configure({
        device: this.device,
        format: format,
        alphaMode: 'premultiplied',
      });

      const shaderCode = `
        struct VertexOutput {
          @builtin(position) position : vec4<f32>,
          @location(0) uv : vec2<f32>,
        };

        @vertex
        fn vs_main(@builtin(vertex_index) vertexIndex : u32) -> VertexOutput {
          var pos = array<vec2<f32>, 4>(
            vec2<f32>(-1.0, -1.0),
            vec2<f32>( 1.0, -1.0),
            vec2<f32>(-1.0,  1.0),
            vec2<f32>( 1.0,  1.0)
          );
          var uvs = array<vec2<f32>, 4>(
            vec2<f32>(0.0, 1.0),
            vec2<f32>(1.0, 1.0),
            vec2<f32>(0.0, 0.0),
            vec2<f32>(1.0, 0.0)
          );
          var output : VertexOutput;
          output.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
          output.uv = uvs[vertexIndex];
          return output;
        }

        @group(0) @binding(0) var mySampler : sampler;
        @group(0) @binding(1) var myTexture : texture_2d<f32>;

        @fragment
        fn fs_main(@location(0) uv : vec2<f32>) -> @location(0) vec4<f32> {
          var color = textureSample(myTexture, mySampler, uv);
          if (color.r > 0.99 && color.g > 0.99 && color.b > 0.99) {
            return vec4<f32>(0.0, 0.0, 0.0, 0.0);
          }
          return color;
        }
      `;

      const shaderModule = this.device.createShaderModule({ code: shaderCode });
      this.pipeline = this.device.createRenderPipeline({
        layout: 'auto',
        vertex: {
          module: shaderModule,
          entryPoint: 'vs_main',
        },
        fragment: {
          module: shaderModule,
          entryPoint: 'fs_main',
          targets: [{ format: format }],
        },
        primitive: {
          topology: 'triangle-strip',
        },
      });

      this.isSupported = true;
      return true;
    } catch (e) {
      console.warn('Failed to initialize WebGPU pipeline:', e);
      return false;
    }
  }

  get isGPUAvailable(): boolean {
    return this.isSupported;
  }

  get activePipeline(): any {
    return this.pipeline;
  }
}
