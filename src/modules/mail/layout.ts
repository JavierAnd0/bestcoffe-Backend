/**
 * Plantilla común de los correos. Lenguaje visual de una etiqueta de café de
 * especialidad: papel crema, el nombre de la tienda compuesto en serifa como
 * en la bolsa, una ficha de datos en versalitas (como "ORIGEN · PROCESO ·
 * NOTAS" en el empaque, aquí "PEDIDO · FECHA · TOTAL"), recibo punteado y
 * firma de la casa.
 *
 * HTML de correo: tablas y estilos en línea (Gmail y Outlook ignoran <style>
 * y casi todo el CSS moderno), una columna de 560 px y fuentes del sistema.
 * Todo texto variable llega ya escapado: aquí solo se arma la estructura.
 */

/** Marca con la que sale un correo: la de la tienda o la de la plataforma. */
export interface MailBrand {
  /** Nombre visible (remitente y cabecera). Sin escapar. */
  name: string;
  /** Web de la tienda o de la plataforma, sin barra final. */
  url: string;
  /** Logo https opcional; si falta se compone el nombre en serifa. */
  logoUrl?: string | null;
  /** Color principal (#rrggbb): el botón. */
  primary?: string | null;
  /** Color de acento (#rrggbb): filetes y rótulos. */
  accent?: string | null;
  /** Ciudad de la tienda: "Café de especialidad · Bogotá". */
  city?: string | null;
  /** Correo de contacto: va al pie del correo y se usa como Reply-To. */
  replyTo?: string | null;
}

export const PLATFORM_NAME = 'Bestkofi';

const INK = '#2A1D15'; // espresso
const BODY = '#4B3B30';
const MUTED = '#8C7B6B';
const RULE = '#E3D6C3';
const PAPER = '#EFE6D8'; // kraft claro
const CARD = '#FFFCF6'; // papel de la etiqueta
const ESPRESSO = '#3B2A1F';
const TERRACOTTA = '#B5562A';
const SERIF = "Georgia, 'Times New Roman', Times, serif";
const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Luminancia relativa (WCAG) de un #rrggbb. */
function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Oscurece un color hacia el negro en pasos hasta llegar al contraste pedido. */
function darkenUntil(hex: string, bg: string, min: number): string {
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  let out = hex;
  for (let i = 0; i < 20 && contrast(out, bg) < min; i++) {
    [r, g, b] = [r, g, b].map((c) => Math.round(c * 0.9));
    out = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  }
  return out;
}

/**
 * Color del botón: el principal de la marca si el texto blanco se lee sobre él
 * (contraste ≥ 4.5:1); si no, espresso.
 */
export function buttonColor(primary: string | null | undefined): string {
  if (!primary || !HEX.test(primary)) return ESPRESSO;
  return contrast(primary, '#FFFFFF') >= 4.5 ? primary : ESPRESSO;
}

/** Acento para texto pequeño sobre el papel: oscurecido si no se lee. */
function accentText(accent: string | null | undefined): string {
  const base = accent && HEX.test(accent) ? accent : TERRACOTTA;
  return darkenUntil(base, CARD, 4.5);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const CONTACT_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;

export interface EmailContent {
  brand: MailBrand;
  /** Texto de vista previa en la bandeja (oculto en el cuerpo). Sin escapar. */
  preheader: string;
  /** Rótulo en versalitas sobre el título ("Pedido confirmado"). Sin escapar. */
  kicker?: string;
  /** Título del correo. Sin escapar. */
  heading: string;
  /** Ficha de datos bajo el título, como la de una bolsa. Sin escapar. */
  facts?: Array<{ label: string; value: string }>;
  /** Párrafos y bloques ya escapados (HTML). */
  body: string;
  /** Acción principal. `href` ya validado y escapado (safeHref). */
  cta?: { label: string; href: string } | null;
  /** Nota final en gris (vencimiento, "si no fuiste tú…"). HTML escapado. */
  note?: string;
  /** Firma: "— El equipo de ORÍGEN". Por defecto, sí en correos de tienda. */
  signoff?: boolean;
}

/** Párrafo con el estilo del cuerpo. */
export function p(html: string): string {
  return `<p style="margin:0 0 20px; text-align:center; font-family:${SANS}; font-size:16px; line-height:1.65; color:${BODY};">${html}</p>`;
}

/** Texto destacado dentro de un párrafo. */
export function strong(s: string): string {
  return `<strong style="color:${INK}; font-weight:600;">${esc(s)}</strong>`;
}

/**
 * Recibo: filas producto / detalle / precio con separador punteado y total.
 * Valores sin escapar (se escapan aquí).
 */
export function receipt(
  rows: Array<{ name: string; detail: string; amount: string }>,
  total: { label: string; amount: string },
): string {
  const cell = `font-family:${SANS}; vertical-align:top; padding:14px 0; border-bottom:1px dotted ${RULE};`;
  const lines = rows
    .map(
      (r) => `
      <tr>
        <td style="${cell}">
          <div style="font-family:${SERIF}; font-size:17px; color:${INK};">${esc(r.name)}</div>
          <div style="margin-top:3px; font-size:11px; letter-spacing:1.2px; text-transform:uppercase; color:${MUTED};">${esc(r.detail)}</div>
        </td>
        <td style="${cell} text-align:right; white-space:nowrap; font-size:15px; color:${INK};">${esc(r.amount)}</td>
      </tr>`,
    )
    .join('');
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px; border-top:1px solid ${INK};">
      ${lines}
      <tr>
        <td style="padding:16px 0 0; font-family:${SANS}; font-size:11px; letter-spacing:1.6px; text-transform:uppercase; color:${INK}; font-weight:700;">${esc(total.label)}</td>
        <td style="padding:16px 0 0; font-family:${SERIF}; font-size:22px; color:${INK}; text-align:right; white-space:nowrap;">${esc(total.amount)}</td>
      </tr>
    </table>`;
}

export function renderEmail(c: EmailContent): string {
  const { brand } = c;
  const isPlatform = brand.name === PLATFORM_NAME;
  const name = esc(brand.name);
  const siteHref = esc(brand.url);
  const accent = accentText(brand.accent);
  const city = brand.city?.trim();
  const tagline = isPlatform
    ? 'Tiendas para tostadores de café'
    : `Café de especialidad${city ? ` · ${city}` : ''}`;

  const mark =
    brand.logoUrl && /^https:\/\//i.test(brand.logoUrl)
      ? `<img src="${esc(brand.logoUrl)}" alt="${name}" height="44" style="display:inline-block; height:44px; width:auto; border:0;">`
      : `<span style="font-family:${SERIF}; font-size:30px; line-height:1.1; letter-spacing:4px; text-transform:uppercase; color:${INK};">${name}</span>`;

  const kicker = c.kicker
    ? `<tr><td align="center" style="padding:0 0 12px; font-family:${SANS}; font-size:11px; font-weight:700; letter-spacing:2.4px; text-transform:uppercase; color:${accent};">${esc(c.kicker)}</td></tr>`
    : '';

  const facts =
    c.facts && c.facts.length
      ? `
          <tr><td style="padding:4px 0 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${RULE}; border-bottom:1px solid ${RULE};">
              <tr>${c.facts
                .map(
                  (f, i) => `
                <td align="center" valign="top" style="padding:14px 6px; ${i > 0 ? `border-left:1px solid ${RULE};` : ''}">
                  <div style="font-family:${SANS}; font-size:10px; letter-spacing:1.8px; text-transform:uppercase; color:${MUTED};">${esc(f.label)}</div>
                  <div style="margin-top:6px; font-family:${SERIF}; font-size:17px; color:${INK};">${esc(f.value)}</div>
                </td>`,
                )
                .join('')}
              </tr>
            </table>
          </td></tr>`
      : '';

  const button = c.cta
    ? `
          <tr><td align="center" style="padding:8px 0 8px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="background:${buttonColor(brand.primary)}; border-radius:2px;">
                <a href="${c.cta.href}" style="display:inline-block; padding:15px 30px; font-family:${SANS}; font-size:12px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:#FFFFFF; text-decoration:none;">${esc(c.cta.label)}</a>
              </td>
            </tr></table>
          </td></tr>`
    : '';

  const signoff =
    (c.signoff ?? !isPlatform)
      ? `<tr><td align="center" style="padding:12px 0 0; font-family:${SERIF}; font-style:italic; font-size:16px; color:${BODY};">— El equipo de ${name}</td></tr>`
      : '';

  // Contacto de la tienda (o de la plataforma): solo si es un correo válido.
  const contact =
    brand.replyTo && CONTACT_RE.test(brand.replyTo)
      ? `¿Dudas? Escríbenos a <a href="mailto:${esc(brand.replyTo)}" style="color:${INK}; text-decoration:underline;">${esc(brand.replyTo)}</a>.`
      : '';
  const footNote = [c.note, contact]
    .filter(Boolean)
    .map((t) => `<p style="margin:0 0 6px;">${t}</p>`)
    .join('');
  const note = footNote
    ? `
          <tr><td style="padding:28px 0 0;">
            <div style="border-top:1px solid ${RULE}; padding-top:18px; text-align:center; font-family:${SANS}; font-size:13px; line-height:1.6; color:${MUTED};">${footNote}</div>
          </td></tr>`
    : '';

  const poweredBy = isPlatform ? '' : ` · Hecho con ${PLATFORM_NAME}`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(c.heading)}</title>
</head>
<body style="margin:0; padding:0; background:${PAPER};">
<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">${esc(c.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};">
  <tr><td align="center" style="padding:36px 12px 40px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
      <tr><td style="background:${CARD}; border:1px solid ${RULE};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="height:6px; background:${INK}; font-size:0; line-height:0;">&nbsp;</td></tr>
          <tr><td align="center" style="padding:36px 32px 0;">
            <a href="${siteHref}" style="text-decoration:none;">${mark}</a>
            <div style="margin-top:10px; font-family:${SANS}; font-size:10px; letter-spacing:2.6px; text-transform:uppercase; color:${MUTED};">${esc(tagline)}</div>
          </td></tr>
          <tr><td style="padding:28px 32px 0;">
            <div style="border-top:1px solid ${INK}; height:3px; border-bottom:1px solid ${INK}; font-size:0; line-height:0;">&nbsp;</div>
          </td></tr>
          <tr><td style="padding:36px 40px 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              ${kicker}
              <tr><td align="center" style="padding:0 0 24px; font-family:${SERIF}; font-size:32px; line-height:1.2; font-weight:normal; color:${INK};">${esc(c.heading)}</td></tr>${facts}
              <tr><td>${c.body}</td></tr>${button}${signoff}${note}
            </table>
          </td></tr>
        </table>
      </td></tr>
      <tr><td align="center" style="padding:22px 8px 0; font-family:${SANS}; font-size:11px; line-height:1.7; letter-spacing:0.4px; color:${MUTED};">
        <a href="${siteHref}" style="color:${MUTED}; text-decoration:none;">${name} · ${esc(hostOf(brand.url))}</a>${poweredBy}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
