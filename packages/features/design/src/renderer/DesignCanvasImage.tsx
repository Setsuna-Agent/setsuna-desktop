import { useEffect, useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { useToast } from '@setsuna-desktop/renderer-ui';
import { Image, Rect } from 'react-konva';
import type { DesignImage } from '../contracts/index.js';
import { designImageFit } from './design-image-fit.js';
import type { LayerPaint } from './design-paint.js';
import type { LoadDesignImage } from './design-images.js';

export function DesignCanvasImage({ node, width, height, loadImage, paint, translate: t }: Readonly<{
  node: DesignImage;
  width: number;
  height: number;
  loadImage: LoadDesignImage;
  paint: LayerPaint;
  translate: RendererTranslate;
}>) {
  const [image, setImage] = useState<HTMLImageElement>();
  const toast = useToast();
  const path = node.assetPath;

  useEffect(() => {
    let active = true;
    void loadImage(path).then((next) => {
      if (active) setImage(next);
    }).catch(() => {
      if (!active) return;
      setImage(undefined);
      toast.error(t('feature.design.loadImageFailed', { path }));
    });
    return () => { active = false; };
  }, [loadImage, path, t, toast]);

  if (!image) return <Rect width={width} height={height} fill="#e5e8ee" {...paint} />;
  return <DesignImageShape node={node} image={image} width={width} height={height} paint={paint} />;
}

export function DesignImageShape({ node, image, width, height, paint }: Readonly<{
  node: DesignImage;
  image: HTMLImageElement;
  width: number;
  height: number;
  paint: LayerPaint;
}>) {
  const fit = designImageFit(node, width, height, image.naturalWidth, image.naturalHeight);
  if (fit.crop) return <Image name="design-image-pixels" image={image} {...fit.bounds} {...paint} crop={fit.crop} />;
  return <>
    <Image image={image} {...fit.bounds} listening={false} shadowColor={paint.shadowColor} shadowBlur={paint.shadowBlur}
      shadowOffsetX={paint.shadowOffsetX} shadowOffsetY={paint.shadowOffsetY} shadowOpacity={paint.shadowOpacity} />
    <Rect width={width} height={height} fill="transparent" stroke={paint.stroke} strokeWidth={paint.strokeWidth} lineJoin={paint.lineJoin} />
  </>;
}
