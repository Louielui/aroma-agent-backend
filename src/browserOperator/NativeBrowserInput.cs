using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Threading;
using System.Windows.Automation;
using System.Web.Script.Serialization;

// A fixed browser-viewport helper, not a shell or a general desktop executor.
public static class NativeBrowserInput {
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
 [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
 [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
 [DllImport("user32.dll")] static extern uint SendInput(uint count,INPUT[] inputs,int size);
 [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
 [StructLayout(LayoutKind.Sequential)] struct POINT {public int x,y;}
 [StructLayout(LayoutKind.Sequential)] struct INPUT {public uint type;public UNION union;}
 [StructLayout(LayoutKind.Explicit)] struct UNION {[FieldOffset(0)]public MOUSE mouse;[FieldOffset(0)]public KEY key;}
 [StructLayout(LayoutKind.Sequential)] struct MOUSE {public int dx,dy;public uint data,flags,time;public UIntPtr extra;}
 [StructLayout(LayoutKind.Sequential)] struct KEY {public ushort vk,scan;public uint flags,time;public UIntPtr extra;}
 static JavaScriptSerializer json=new JavaScriptSerializer{MaxJsonLength=2100000};
 static void Need(bool condition,string code){if(!condition)throw new InvalidOperationException(code);}
 static Dictionary<string,object> Object(object value,string[] keys){var o=value as Dictionary<string,object>;Need(o!=null&&o.Keys.OrderBy(x=>x).SequenceEqual(keys.OrderBy(x=>x)),"invalid_native_action");return o;}
 static double Number(object value){Need(value is int||value is long||value is decimal||value is double,"invalid_native_action");double n=Convert.ToDouble(value);Need(!Double.IsNaN(n)&&!Double.IsInfinity(n),"invalid_native_action");return n;}
 static bool Inside(System.Windows.Rect a,System.Windows.Rect b){return !a.IsEmpty&&!b.IsEmpty&&a.Left>=b.Left&&a.Top>=b.Top&&a.Right<=b.Right&&a.Bottom<=b.Bottom;}
 static bool UnderDocument(AutomationElement e){for(int i=0;e!=null&&i<40;i++,e=TreeWalker.ControlViewWalker.GetParent(e))if(e.Current.ControlType==ControlType.Document)return true;return false;}
 static bool InDocument(AutomationElement e,AutomationElement doc){for(int i=0;e!=null&&i<40;i++,e=TreeWalker.ControlViewWalker.GetParent(e))if(e.Current.ControlType==ControlType.Document)return e.GetRuntimeId().SequenceEqual(doc.GetRuntimeId());return false;}
 static string Value(AutomationElement e){object pattern;if(e.TryGetCurrentPattern(ValuePattern.Pattern,out pattern))return ((ValuePattern)pattern).Current.Value;return null;}
 static bool Matches(string value,string url){return value==url||url.StartsWith("https://")&&value==url.Substring(8);}
 // Chrome may omit HTTP in the address display only for this exact owned fixture.
 // The independent Document URL below still uses the original full-URL predicate.
 static bool MatchesAddress(string value,string url){return Matches(value,url)||url=="http://127.0.0.1:8090/browser-operator-fixture"&&value==url.Substring(7);}
 static AutomationElement Bind(string url,IntPtr expected){
  IntPtr hwnd=GetForegroundWindow();Need(hwnd!=IntPtr.Zero&&(expected==IntPtr.Zero||hwnd==expected),"browser_foreground_changed");uint pid;GetWindowThreadProcessId(hwnd,out pid);
  using(var p=Process.GetProcessById((int)pid)){Need(p.ProcessName.Equals("chrome",StringComparison.OrdinalIgnoreCase)&&p.SessionId==Process.GetCurrentProcess().SessionId,"browser_foreground_changed");string image=p.MainModule.FileName;var approved=new[]{Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Google/Chrome/Application/chrome.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),"Google/Chrome/Application/chrome.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Google/Chrome/Application/chrome.exe")};Need(approved.Any(v=>Path.GetFullPath(v).Equals(image,StringComparison.OrdinalIgnoreCase)),"browser_foreground_changed");}
  Need((GetAsyncKeyState(0x1B)&0x8000)==0,"owner_stopped_native_input");
  var root=AutomationElement.FromHandle(hwnd);var edits=root.FindAll(TreeScope.Descendants,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Edit));int addresses=0;
  foreach(AutomationElement e in edits){string name=e.Current.Name;if(!UnderDocument(e)&&(name=="Address and search bar"||name=="Address bar")&&!e.Current.IsPassword&&!e.Current.HasKeyboardFocus&&MatchesAddress(Value(e),url))addresses++;}
  Need(addresses==1,"browser_url_unverified");
  var docs=root.FindAll(TreeScope.Descendants,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Document));AutomationElement doc=null;
  foreach(AutomationElement d in docs)if(!d.Current.IsOffscreen&&Matches(Value(d),url)){Need(doc==null,"browser_viewport_ambiguous");doc=d;}
  Need(doc!=null&&Inside(doc.Current.BoundingRectangle,root.Current.BoundingRectangle),"browser_viewport_unverified");return doc;
 }
 static string Fingerprint(Bitmap b){var data=b.LockBits(new Rectangle(0,0,b.Width,b.Height),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);try{byte[] bytes=new byte[Math.Abs(data.Stride)*data.Height];Marshal.Copy(data.Scan0,bytes,0,bytes.Length);using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}finally{b.UnlockBits(data);}}
 static Bitmap Capture(System.Windows.Rect r){Need(r.Width>=100&&r.Height>=100&&r.Width<=8000&&r.Height<=8000,"browser_viewport_unverified");var b=new Bitmap((int)r.Width,(int)r.Height,PixelFormat.Format32bppArgb);try{using(var g=Graphics.FromImage(b)){g.CopyFromScreen((int)r.Left,(int)r.Top,0,0,b.Size,CopyPixelOperation.SourceCopy);}return b;}catch{b.Dispose();throw;}}
 static object Rect(System.Windows.Rect r){return new{left=r.Left,top=r.Top,width=r.Width,height=r.Height};}
 static void Send(INPUT[] inputs){Need(SendInput((uint)inputs.Length,inputs,Marshal.SizeOf(typeof(INPUT)))==inputs.Length,"native_input_unknown");}
 static INPUT Mouse(uint flags,uint data=0){return new INPUT{type=0,union=new UNION{mouse=new MOUSE{flags=flags,data=data}}};}
 static INPUT Key(ushort vk,ushort scan,uint flags){return new INPUT{type=1,union=new UNION{key=new KEY{vk=vk,scan=scan,flags=flags}}};}
 public static int Main(string[] args){
  try{
   Need(args.Length==0,"invalid_native_action");SetProcessDPIAware();string wire=Console.In.ReadToEnd();Need(wire.Length<=6000,"invalid_native_action");var body=Object(json.DeserializeObject(wire),new[]{"op","url","width","height","frame","action"});string op=body["op"] as string,url=body["url"] as string;
   Need((op=="capture"||op=="execute")&&url!=null&&url.Length<=2048,"invalid_native_action");Uri uri;Need(Uri.TryCreate(url,UriKind.Absolute,out uri)&&uri.UserInfo==""&&uri.Fragment==""&&(uri.Scheme=="https"&&uri.Host=="app.7shifts.com"||url=="http://127.0.0.1:8090/browser-operator-fixture"),"native_site_unavailable");
   IntPtr expected=IntPtr.Zero;Dictionary<string,object> frame=null;
   if(op=="execute"){frame=Object(body["frame"],new[]{"window","fingerprint","rect"});long window;Need(Int64.TryParse(frame["window"] as string,out window)&&window>0,"invalid_native_action");expected=new IntPtr(window);}else Need(body["frame"]==null&&body["action"]==null,"invalid_native_action");
   var doc=Bind(url,expected);var r=doc.Current.BoundingRectangle;double width=Number(body["width"]),height=Number(body["height"]);Need(width>=100&&height>=100&&width<=8000&&height<=8000&&Math.Abs(r.Width/width-r.Height/height)<0.02,"browser_viewport_changed");IntPtr hwnd=GetForegroundWindow();
   using(var bitmap=Capture(r)){
    string fingerprint=Fingerprint(bitmap);
    if(op=="capture"){
     int targetWidth=Math.Min(bitmap.Width,1280),targetHeight=(int)Math.Round((double)bitmap.Height*targetWidth/bitmap.Width);Need(targetHeight<=4096,"browser_image_too_large");
     using(var scaled=new Bitmap(bitmap,new Size(targetWidth,targetHeight)))using(var stream=new MemoryStream()){
      scaled.Save(stream,ImageFormat.Png);Need(stream.Length<=1500000,"browser_image_too_large");Console.Write(json.Serialize(new{image="data:image/png;base64,"+Convert.ToBase64String(stream.ToArray()),fingerprint=fingerprint,window=hwnd.ToInt64().ToString(),rect=Rect(r),capturedAt=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}));return 0;
     }
    }
    Need(fingerprint==frame["fingerprint"] as string,"browser_pixels_changed");var old=Object(frame["rect"],new[]{"left","top","width","height"});Need(Number(old["left"])==r.Left&&Number(old["top"])==r.Top&&Number(old["width"])==r.Width&&Number(old["height"])==r.Height,"browser_viewport_changed");
   }
   var action=Object(body["action"],new[]{"kind","x","y","text","targetLabel","targetHref"});string kind=action["kind"] as string,text=action["text"] as string,label=action["targetLabel"] as string,href=action["targetHref"] as string;double x=Number(action["x"]),y=Number(action["y"]);Need(x>=0&&x<=1&&y>=0&&y<=1&&text!=null&&label!=null&&label.Length<=120&&href!=null,"invalid_native_action");
   Need(new[]{"move","click","scroll_up","scroll_down","type","enter"}.Contains(kind),"invalid_native_action");bool fixture=url=="http://127.0.0.1:8090/browser-operator-fixture";
   Need(!new[]{"type","enter"}.Contains(kind)||fixture,"live_typing_not_allowed");Need(kind=="type"?text=="Imagine test":text=="","invalid_native_action");
   POINT initial;Need(GetCursorPos(out initial),"native_input_unavailable");int endX=(int)(r.Left+x*(r.Width-1)),endY=(int)(r.Top+y*(r.Height-1));POINT last=initial;
   for(int i=1;i<=12;i++){
    Bind(url,hwnd);Need(doc.Current.BoundingRectangle==r,"browser_viewport_changed");POINT actual;Need(GetCursorPos(out actual)&&actual.x==last.x&&actual.y==last.y,"owner_moved_pointer");
    int nx=initial.x+(endX-initial.x)*i/12,ny=initial.y+(endY-initial.y)*i/12;Need(SetCursorPos(nx,ny),"native_input_unavailable");last.x=nx;last.y=ny;Thread.Sleep(8);
   }
   Bind(url,hwnd);Need(doc.Current.BoundingRectangle==r,"browser_viewport_changed");var hit=AutomationElement.FromPoint(new System.Windows.Point(endX,endY));Need(InDocument(hit,doc)&&Inside(hit.Current.BoundingRectangle,r),"native_target_outside_page");
   if(kind=="click"){
    var candidate=hit;bool matched=false;
    for(int i=0;candidate!=null&&i<12;i++,candidate=TreeWalker.ControlViewWalker.GetParent(candidate)){
     if(candidate.Current.ControlType==ControlType.Document)break;
     if(candidate.Current.Name==label&&InDocument(candidate,doc)&&(fixture?(href==url&&(candidate.Current.ControlType==ControlType.Button||candidate.Current.ControlType==ControlType.Edit)):(candidate.Current.ControlType==ControlType.Hyperlink&&System.Text.RegularExpressions.Regex.IsMatch(href,"^https://app\\.7shifts\\.com/company/[1-9][0-9]*/employees(/list)?$")))){matched=true;break;}
    }
    Need(matched,"native_click_target_changed");Send(new[]{Mouse(0x0002),Mouse(0x0004)});
   }
   if(kind=="scroll_up"||kind=="scroll_down")Send(new[]{Mouse(0x0800,unchecked((uint)(kind=="scroll_up"?360:-360)))});
   if(kind=="type"||kind=="enter"){
    var focused=AutomationElement.FocusedElement;Need(focused!=null&&focused.Current.ControlType==ControlType.Edit&&!focused.Current.IsPassword&&focused.Current.Name=="Fixture input"&&InDocument(focused,doc)&&Inside(focused.Current.BoundingRectangle,r),"native_typing_target_unavailable");
    if(kind=="type"){var inputs=new List<INPUT>();foreach(char c in text){inputs.Add(Key(0,c,4));inputs.Add(Key(0,c,6));}Send(inputs.ToArray());}else Send(new[]{Key(13,0,0),Key(13,0,2)});
   }
   Console.Write("{\"success\":true}");return 0;
  }catch(Exception e){string code=e is InvalidOperationException?e.Message:"native_input_unavailable";Console.Write(json.Serialize(new{error=code}));return 3;}
 }
}
