import sharp from 'sharp';
import {
  COLLAGE_SIZE_PX,
  IMAGE_GRID_LAYOUT,
  MAX_COLLAGE_IMAGES,
} from '../config';

const BG = { r: 28, g: 28, b: 30 };
const JPEG_QUALITY = 85;

export async function buildCollage(imageBuffers: Buffer[]): Promise<Buffer> {
  const trimmed = imageBuffers.slice(0, MAX_COLLAGE_IMAGES);
  const layout = IMAGE_GRID_LAYOUT[trimmed.length];
  if (!layout) {
    throw new Error(
      `no grid layout for count=${trimmed.length} (collage only supports 5–${MAX_COLLAGE_IMAGES} images)`,
    );
  }

  const { cols, rows } = layout;
  const tileWidth = Math.floor(COLLAGE_SIZE_PX / cols);
  const tileHeight = Math.floor(COLLAGE_SIZE_PX / rows);

  const tiles = await Promise.all(
    trimmed.map((buf) =>
      sharp(buf)
        .resize(tileWidth, tileHeight, { fit: 'cover', position: 'attention' })
        .toBuffer(),
    ),
  );

  const composites = tiles.map((input, i) => ({
    input,
    left: (i % cols) * tileWidth,
    top: Math.floor(i / cols) * tileHeight,
  }));

  return sharp({
    create: {
      width: COLLAGE_SIZE_PX,
      height: COLLAGE_SIZE_PX,
      channels: 3,
      background: BG,
    },
  })
    .composite(composites)
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
}
