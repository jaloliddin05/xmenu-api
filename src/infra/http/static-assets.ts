import type { NestExpressApplication } from '@nestjs/platform-express';
import { extname, join } from 'path';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

/** Response headers for a served upload: nosniff always; anything that is not a plain image never renders. */
export function uploadHeaders(res: { setHeader(name: string, value: string): unknown }, filePath: string) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!IMAGE_EXTS.has(extname(filePath).toLowerCase())) {
    res.setHeader('Content-Disposition', 'attachment');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  }
}

/**
 * Serves `uploads/` at the site root (URLs stored in the DB look like /image/products/x.jpg). Missing files
 * fall through to the regular 404, which never mentions a filesystem path.
 */
export function configureStatic(app: NestExpressApplication, root = join(process.cwd(), 'uploads')) {
  app.useStaticAssets(root, {
    index: false,
    fallthrough: true,
    dotfiles: 'ignore',
    setHeaders: uploadHeaders,
  });
}
