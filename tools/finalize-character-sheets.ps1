param(
  [Parameter(Mandatory = $true)][string[]]$Sources,
  [string[]]$UpperSources = @(),
  [string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent)
)
$ErrorActionPreference = 'Stop'
if ($Sources.Count -ne 5) { throw 'Provide five reviewed ImageGen atlases.' }
Add-Type -AssemblyName System.Drawing
# ImageGen authors the artwork. This exporter only assembles reviewed regions,
# fits cells with one scale per character, and flattens the opaque background.
Add-Type -ReferencedAssemblies @([System.Object].Assembly.Location, [System.Drawing.Bitmap].Assembly.Location, [System.Drawing.Color].Assembly.Location, (Join-Path $PSHOME 'System.Runtime.dll'), (Join-Path $PSHOME 'System.Private.Windows.GdiPlus.dll'), (Join-Path $PSHOME 'System.Private.Windows.Core.dll'), (Join-Path $PSHOME 'System.Collections.dll'), (Join-Path $PSHOME 'System.Drawing.dll'), (Join-Path $PSHOME 'System.ComponentModel.Primitives.dll')) -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
public static class CharacterExport {
  static readonly Color Bg = Color.FromArgb(255,160,152,149);
  static bool Background(Color c) {
    return Math.Abs(c.R-160)<32 && Math.Abs(c.G-152)<32 && Math.Abs(c.B-149)<32
      && Math.Max(c.R,Math.Max(c.G,c.B))-Math.Min(c.R,Math.Min(c.G,c.B))<25;
  }
  static Bitmap Clean(string path) {
    var b=new Bitmap(path); int w=b.Width,h=b.Height;
    var seen=new bool[w*h]; var q=new int[w*h*4+2*w+2*h];int head=0,tail=0;
    for(int x=0;x<w;x++){q[tail++]=x;q[tail++]=(h-1)*w+x;}
    for(int y=0;y<h;y++){q[tail++]=y*w;q[tail++]=y*w+w-1;}
    while(head<tail){int p=q[head++];if(seen[p])continue;seen[p]=true;
      int x=p%w,y=p/w;if(!Background(b.GetPixel(x,y)))continue;
      b.SetPixel(x,y,Bg);
      if(x>0)q[tail++]=p-1;if(x<w-1)q[tail++]=p+1;
      if(y>0)q[tail++]=p-w;if(y<h-1)q[tail++]=p+w;
    }
    return b;
  }
  static bool Ink(Bitmap b,int x,int y){return b.GetPixel(x,y).ToArgb()!=Bg.ToArgb();}
  static int[] Cuts(Bitmap b){
    int[] cuts={0,0,0,0,b.Height};
    for(int row=1;row<4;row++){
      int target=(int)Math.Round(b.Height*row/4.0);bool found=false;
      for(int d=0;d<b.Height/16&&!found;d++)foreach(int y in new int[]{target+d,target-d}){
        bool empty=true;for(int x=0;x<b.Width;x++)if(Ink(b,x,y)){empty=false;break;}
        if(empty){cuts[row]=y;found=true;break;}
      }
      if(!found)throw new Exception("No clear row boundary in generated sheet");
    }return cuts;
  }
  static Rectangle Bounds(Bitmap b,Rectangle cell){
    int l=cell.Right,t=cell.Bottom,r=cell.Left,bt=cell.Top;
    for(int y=cell.Top;y<cell.Bottom;y++)for(int x=cell.Left;x<cell.Right;x++)if(Ink(b,x,y)){
      l=Math.Min(l,x);t=Math.Min(t,y);r=Math.Max(r,x+1);bt=Math.Max(bt,y+1);
    }
    if(l>=r||t>=bt)throw new Exception("Empty frame");return Rectangle.FromLTRB(l,t,r,bt);
  }
  public static void Export(string input,string upper,string output,int character){
    using(var b=Clean(input)){
      // For char_2/4 retain the unmirrored head, costume and upper torso from
      // the first reviewed version; take the opposite foot pose from the edit.
      if(!String.IsNullOrEmpty(upper))using(var u=Clean(upper)){
        if(u.Size!=b.Size)throw new Exception("Assembly variants must share dimensions");
        int end=(int)Math.Round(b.Height*(character==2 ? 0.445 : 0.422)); // Waist seam.
        for(int y=b.Height/4;y<end;y++)for(int x=b.Width/2;x<b.Width;x++)b.SetPixel(x,y,u.GetPixel(x,y));
      }
      int[] cuts=Cuts(b);var boxes=new Rectangle[8];double scale=1;
      for(int i=0;i<8;i++){
        int row=i/2,col=i%2,x0=(int)Math.Round(b.Width*col/2.0),x1=(int)Math.Round(b.Width*(col+1)/2.0);
        boxes[i]=Bounds(b,Rectangle.FromLTRB(x0,cuts[row],x1,cuts[row+1]));
        scale=Math.Min(scale,Math.Min(220.0/boxes[i].Width,220.0/boxes[i].Height));
      }
      using(var result=new Bitmap(512,1024,PixelFormat.Format24bppRgb)){
        using(var g=Graphics.FromImage(result))g.Clear(Bg);
        for(int i=0;i<8;i++){
          var box=boxes[i];int w=(int)Math.Round(box.Width*scale),h=(int)Math.Round(box.Height*scale);
          int dx=(i%2)*256+(256-w)/2,dy=(i/2)*256+240-h;
          for(int y=0;y<h;y++)for(int x=0;x<w;x++){
            int sx=box.Left+Math.Min(box.Width-1,(int)((x+0.5)/scale));
            int sy=box.Top+Math.Min(box.Height-1,(int)((y+0.5)/scale));
            result.SetPixel(dx+x,dy+y,b.GetPixel(sx,sy));
          }
        }
        result.Save(output,ImageFormat.Png);
      }
    }
  }
  public static string Check(string path){
    using(var b=new Bitmap(path)){
      if(b.Width!=512||b.Height!=1024)throw new Exception("Wrong dimensions");
      var counts=new int[4];
      for(int row=0;row<4;row++){
        int changed=0;
        for(int y=0;y<256;y++)for(int x=0;x<256;x++){
          var a=b.GetPixel(x,row*256+y);var c=b.GetPixel(x+256,row*256+y);
          if(a.A!=255||c.A!=255)throw new Exception("Nonopaque pixel");
          if((x<12||x>=244||y<12||y>=244)&&(a.ToArgb()!=Bg.ToArgb()||c.ToArgb()!=Bg.ToArgb()))throw new Exception("Unsafe frame edge");
          if(a.ToArgb()!=c.ToArgb())changed++;
        }
        if(changed==0)throw new Exception("Duplicate animation frames");counts[row]=changed;
      }
      return "512x1024 RGB; opaque; 12px safe edges; frame differences: "+String.Join(", ",counts);
    }
  }
  public static void Preview(string root,string output){
    using(var preview=new Bitmap(1280,1024,PixelFormat.Format24bppRgb)){
      using(var g=Graphics.FromImage(preview)){
        g.Clear(Bg);
        for(int i=0;i<5;i++)using(var b=new Bitmap(System.IO.Path.Combine(root,"char_"+i+".png")))
          g.DrawImage(b,new Rectangle(i*256,0,256,1024),new Rectangle(0,0,256,1024),GraphicsUnit.Pixel);
      }preview.Save(output,ImageFormat.Jpeg);
    }
  }
}
'@
$sourceRoot = Join-Path $ProjectRoot 'tools/generated-inputs/characters'
$runtimeRoot = Join-Path $ProjectRoot 'public/generated-pixel-assets/characters'
for ($i = 0; $i -lt 5; $i++) {
  $upper = if ($UpperSources.Count -eq 5) { $UpperSources[$i] } else { '' }
  $destination = Join-Path $sourceRoot "char_$i.png"
  [CharacterExport]::Export($Sources[$i], $upper, $destination, $i)
  Write-Output "char_${i}: $([CharacterExport]::Check($destination))"
  Copy-Item -LiteralPath $destination -Destination (Join-Path $runtimeRoot "char_$i.png") -Force
}
[CharacterExport]::Preview($sourceRoot, (Join-Path $ProjectRoot 'docs/character-sprites-preview.jpg'))


