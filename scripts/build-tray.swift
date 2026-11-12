import AppKit
import Foundation
// Companion to the editable HUD rings: a native macOS template, not a coloured tile.
for scale in [1,2] {
 let pixels=18*scale
 let rep=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:pixels,pixelsHigh:pixels,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
 rep.size=NSSize(width:18,height:18)
 NSGraphicsContext.saveGraphicsState()
 NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:rep)
 let transform=NSAffineTransform();transform.scale(by:CGFloat(scale));transform.concat()
 NSColor.black.setStroke();NSColor.black.setFill()
 for (radius,width,arcs) in [(7.0,1.6,[(12.0,112.0),(134.0,234.0),(256.0,356.0)]),(3.7,1.3,[(36.0,158.0),(205.0,327.0)])] {
  for (start,end) in arcs {let p=NSBezierPath();p.lineWidth=width;p.lineCapStyle = .round;p.appendArc(withCenter:NSPoint(x:9,y:9),radius:radius,startAngle:start,endAngle:end);p.stroke()}
 }
 NSBezierPath(ovalIn:NSRect(x:8,y:8,width:2,height:2)).fill()
 NSGraphicsContext.restoreGraphicsState()
 let name=scale==1 ? "jarvisTrayTemplate.png":"jarvisTrayTemplate@2x.png"
 try rep.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:"assets/brand/"+name))
}
