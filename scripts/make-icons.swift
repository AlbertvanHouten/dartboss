// Draws the app icon and launch image (the 20 bed with 5 and 1 beside it, under a number ring) as PNGs.
//   swift scripts/make-icons.swift icon    1024 web/icons/icon-1024.png   (full-bleed, opaque: App Store)
//   swift scripts/make-icons.swift mask     512 web/icons/maskable-512.png (motif kept inside the safe zone)
//   swift scripts/make-icons.swift splash  2732 splash.png                 (dark launch screen)
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count == 4, let size = Int(args[2]) else {
  print("usage: make-icons.swift icon|mask|splash SIZE OUT.png"); exit(1)
}
let kind = args[1], out = args[3]
let S = CGFloat(size)

func rgb(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
  CGColor(srgbRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: a)
}
let space = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
// Work y-down like the SVG the icon was designed in
ctx.translateBy(x: 0, y: S); ctx.scaleBy(x: 1, y: -1)

// Background: dark wall lit from near the top for icons, near-black for the launch screen
if kind == "splash" {
  ctx.setFillColor(rgb(0x0b100e)); ctx.fill(CGRect(x: 0, y: 0, width: S, height: S))
} else {
  let g = CGGradient(colorsSpace: space, colors: [rgb(0x2b3430), rgb(0x141b18), rgb(0x0a0f0d)] as CFArray, locations: [0, 0.55, 1])!
  ctx.drawRadialGradient(g, startCenter: CGPoint(x: S * 0.5, y: S * 0.18), startRadius: 0,
                         endCenter: CGPoint(x: S * 0.5, y: S * 0.18), endRadius: S * 0.84, options: [.drawsAfterEndLocation])
}

// Motif in a 1024 box centred on the canvas; the bull sits 300 below the centre
let m: CGFloat = kind == "icon" ? 1 : kind == "mask" ? 0.72 : 0.29
ctx.translateBy(x: S / 2, y: S / 2); ctx.scaleBy(x: S / 1024 * m, y: S / 1024 * m); ctx.translateBy(x: 0, y: 300)

// Angles in degrees clockwise from 12 o'clock
func sector(_ r1: CGFloat, _ r2: CGFloat, _ from: Double, _ to: Double) -> CGPath {
  let a1 = (from - 90) * .pi / 180, a2 = (to - 90) * .pi / 180
  let p = CGMutablePath()
  p.addArc(center: .zero, radius: r2, startAngle: a1, endAngle: a2, clockwise: false)
  p.addArc(center: .zero, radius: r1, startAngle: a2, endAngle: a1, clockwise: true)
  p.closeSubpath()
  return p
}
let black = rgb(0x1b1d1c), cream = rgb(0xe8dcbc), red = rgb(0xc6262f), green = rgb(0x12814a)
ctx.setStrokeColor(rgb(0x9a9d9b)); ctx.setLineWidth(10); ctx.setLineJoin(.round)
func shape(_ p: CGPath, _ fill: CGColor, stroke: Bool = true) {
  ctx.addPath(p); ctx.setFillColor(fill); ctx.drawPath(using: stroke ? .fillStroke : .fill)
}
shape(sector(515, 602, -40.5, 40.5), rgb(0x151716))
for bed in [-27.0, 0, 27] {
  let mid = bed == 0
  for (r1, r2, ring) in [(74.0, 290.0, "S"), (290.0, 345.0, "T"), (345.0, 460.0, "S"), (460.0, 515.0, "D")] {
    shape(sector(CGFloat(r1), CGFloat(r2), bed - 13.5, bed + 13.5), ring == "S" ? (mid ? black : cream) : (mid ? red : green))
  }
}
shape(CGPath(ellipseIn: CGRect(x: -74, y: -74, width: 148, height: 148), transform: nil), green)
shape(CGPath(ellipseIn: CGRect(x: -34, y: -34, width: 68, height: 68), transform: nil), red, stroke: false)

// Numbers in Barlow Condensed 700, the app's own font, set upright along the radius
let fontURL = URL(fileURLWithPath: "web/fonts/barlow-condensed-700-latin.woff2")  // run from the repo root, like npm does
guard let fontData = try? Data(contentsOf: fontURL),
      let desc = (CTFontManagerCreateFontDescriptorsFromData(fontData as CFData) as? [CTFontDescriptor])?.first else {
  print("cannot load \(fontURL.path)"); exit(1)
}
let font = CTFontCreateWithFontDescriptor(desc, 85, nil)
for (n, bed) in [("5", -27.0), ("20", 0), ("1", 27)] {
  let line = CTLineCreateWithAttributedString(NSAttributedString(string: n, attributes: [
    kCTFontAttributeName as NSAttributedString.Key: font, kCTForegroundColorAttributeName as NSAttributedString.Key: rgb(0xd6dad8)]))
  let w = CTLineGetTypographicBounds(line, nil, nil, nil)
  ctx.saveGState()
  ctx.rotate(by: bed * .pi / 180); ctx.translateBy(x: 0, y: -528)
  ctx.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
  ctx.textPosition = CGPoint(x: -w / 2, y: 0)
  CTLineDraw(line, ctx)
  ctx.restoreGState()
}

let img = ctx.makeImage()!
let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: out) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, img, nil)
CGImageDestinationFinalize(dest)
print("wrote \(out)")
