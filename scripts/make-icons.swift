// Draws the app icon and launch image (a dartboard on felt) as PNGs.
//   swift scripts/make-icons.swift icon    1024 web/icons/icon-1024.png   (full-bleed, opaque: App Store)
//   swift scripts/make-icons.swift mask     512 web/icons/maskable-512.png (board kept inside the safe zone)
//   swift scripts/make-icons.swift splash  2732 splash.png                 (dark launch screen)
import CoreGraphics
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

// Background: felt green with a soft light from the top for icons, near-black for the launch screen
if kind == "splash" {
  ctx.setFillColor(rgb(0x0b100e)); ctx.fill(CGRect(x: 0, y: 0, width: S, height: S))
} else {
  let g = CGGradient(colorsSpace: space, colors: [rgb(0x2a7a58), rgb(0x17573d), rgb(0x0b3122)] as CFArray, locations: [0, 0.55, 1])!
  ctx.drawRadialGradient(g, startCenter: CGPoint(x: S * 0.5, y: S * 0.78), startRadius: 0,
                         endCenter: CGPoint(x: S * 0.5, y: S * 0.5), endRadius: S * 0.85, options: [.drawsAfterEndLocation])
}

// Board geometry in regulation millimetres, scaled so the black surround has radius `outer`
let outer: CGFloat = kind == "icon" ? S * 0.40 : kind == "mask" ? S * 0.31 : S * 0.11
let k = outer / 199
let c = CGPoint(x: S / 2, y: S / 2)
let order = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5]

// Drop shadow under the board
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -outer * 0.06), blur: outer * 0.18, color: rgb(0x000000, 0.55))
ctx.setFillColor(rgb(0x151716)); ctx.fillEllipse(in: CGRect(x: c.x - outer, y: c.y - outer, width: outer * 2, height: outer * 2))
ctx.restoreGState()

func sector(_ r1: CGFloat, _ r2: CGFloat, _ i: Int) -> CGPath {
  // Angles measured clockwise from 12 o'clock; CoreGraphics y points up
  let a1 = (90 - (Double(i) * 18 - 9)) * .pi / 180, a2 = (90 - (Double(i) * 18 + 9)) * .pi / 180
  let p = CGMutablePath()
  p.addArc(center: c, radius: r2 * k, startAngle: a1, endAngle: a2, clockwise: true)
  p.addArc(center: c, radius: r1 * k, startAngle: a2, endAngle: a1, clockwise: false)
  p.closeSubpath()
  return p
}
let black = rgb(0x1b1d1c), cream = rgb(0xe8dcbc), red = rgb(0xc6262f), green = rgb(0x12814a)
for i in 0..<20 {
  let even = i % 2 == 0
  for (r1, r2, ring) in [(15.9, 99.0, "S"), (99.0, 107.0, "T"), (107.0, 162.0, "S"), (162.0, 170.0, "D")] {
    ctx.addPath(sector(CGFloat(r1), CGFloat(r2), i))
    ctx.setFillColor(ring == "S" ? (even ? black : cream) : (even ? red : green))
    ctx.fillPath()
  }
}
ctx.setFillColor(green); ctx.fillEllipse(in: CGRect(x: c.x - 15.9 * k, y: c.y - 15.9 * k, width: 31.8 * k, height: 31.8 * k))
ctx.setFillColor(red); ctx.fillEllipse(in: CGRect(x: c.x - 6.35 * k, y: c.y - 6.35 * k, width: 12.7 * k, height: 12.7 * k))
// Wire around the doubles and a light rim on the surround
ctx.setStrokeColor(rgb(0xb9bcb8, 0.7)); ctx.setLineWidth(max(1, 1.4 * k))
ctx.strokeEllipse(in: CGRect(x: c.x - 170 * k, y: c.y - 170 * k, width: 340 * k, height: 340 * k))
ctx.setStrokeColor(rgb(0xffffff, 0.14)); ctx.setLineWidth(max(1, 2 * k))
ctx.strokeEllipse(in: CGRect(x: c.x - 197 * k, y: c.y - 197 * k, width: 394 * k, height: 394 * k))
// Soft shading towards the edge of the board
let shade = CGGradient(colorsSpace: space, colors: [rgb(0x000000, 0), rgb(0x000000, 0.28)] as CFArray, locations: [0.6, 1])!
ctx.saveGState()
ctx.addEllipse(in: CGRect(x: c.x - 170 * k, y: c.y - 170 * k, width: 340 * k, height: 340 * k)); ctx.clip()
ctx.drawRadialGradient(shade, startCenter: CGPoint(x: c.x, y: c.y + 10 * k), startRadius: 0, endCenter: c, endRadius: 172 * k, options: [])
ctx.restoreGState()

let img = ctx.makeImage()!
let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: out) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, img, nil)
CGImageDestinationFinalize(dest)
print("wrote \(out)")
