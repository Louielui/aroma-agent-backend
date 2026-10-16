// Disposable test infrastructure only. Never installed as a production launcher.
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public static class OfflineFixtureJob {
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFO { public int cb; public IntPtr reserved, desktop, title; public int x,y,xsize,ysize,xchars,ychars,fill,flags; public short show,reserved2; public IntPtr reserved3,input,output,error; }
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO si; public IntPtr attributes; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESSINFO { public IntPtr process,thread; public uint pid,tid; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr OpenJobObject(uint access,bool inherit,string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,IntPtr info,uint length,out uint returned);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,uint flags,ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string exe,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUPINFOEX si,out PROCESSINFO pi);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static void Check(bool ok) { if(!ok) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
  static string Quote(string s) {
    StringBuilder result=new StringBuilder("\"");int slashes=0;
    foreach(char c in s) {
      if(c=='\\'){slashes++;continue;}
      if(c=='\"')result.Append('\\',slashes*2+1);else result.Append('\\',slashes);
      result.Append(c);slashes=0;
    }
    result.Append('\\',slashes*2);result.Append('"');return result.ToString();
  }
  static string Inspect(IntPtr job,string name) {
    IntPtr limits=Marshal.AllocHGlobal(256), list=Marshal.AllocHGlobal(65536); uint returned;
    try {
      if(IntPtr.Size!=8)throw new Exception("x64_fixture_required");
      Check(QueryInformationJobObject(job,9,limits,144,out returned));
      uint flags=(uint)Marshal.ReadInt32(limits,16);
      Check(QueryInformationJobObject(job,3,list,65536,out returned));
      int assigned=Marshal.ReadInt32(list),count=Marshal.ReadInt32(list,4);
      if(count!=assigned || count<0 || count>4000) throw new Exception("incomplete_job_inventory");
      StringBuilder pids=new StringBuilder();
      for(int i=0;i<count;i++){ if(i>0)pids.Append(',');pids.Append(Marshal.ReadIntPtr(list,8+i*IntPtr.Size).ToInt64()); }
      return "{\"job\":\""+name+"\",\"limitFlags\":"+flags+",\"active\":"+count+",\"pids\":["+pids+"]}";
    } finally { Marshal.FreeHGlobal(limits);Marshal.FreeHGlobal(list); }
  }
  public static int Main(string[] args) {
    try {
      if(args.Length<2 || !System.Text.RegularExpressions.Regex.IsMatch(args[1],@"^imagine-fixture-[a-f0-9-]{36}$"))throw new Exception("fixture_job_required");
      if(args[0]=="probe") {
        IntPtr j=OpenJobObject(4,false,args[1]); if(j==IntPtr.Zero)throw new Exception("job_unavailable");
        try { Console.WriteLine(Inspect(j,args[1])); } finally { CloseHandle(j); } return 0;
      }
      if((args[0]!="launch"&&args[0]!="join")||args.Length<4)throw new Exception("invalid_command");
      IntPtr job=CreateJobObject(IntPtr.Zero,args[1]);Check(job!=IntPtr.Zero);
      bool exists=Marshal.GetLastWin32Error()==183;
      if(exists!=(args[0]=="join"))throw new Exception("job_identity_changed");
      if(!Inspect(job,args[1]).Contains("\"limitFlags\":0,"))throw new Exception("job_limits_changed");
      // Atomic job assignment before the initial thread runs. No breakaway or
      // kill-on-close flags: losing the host is not forced task cancellation.
      IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size);
      IntPtr attrs=Marshal.AllocHGlobal(size),value=Marshal.AllocHGlobal(IntPtr.Size);
      try {
        Check(InitializeProcThreadAttributeList(attrs,1,0,ref size));Marshal.WriteIntPtr(value,job);
        Check(UpdateProcThreadAttribute(attrs,0,new IntPtr(0x2000d),value,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero));
        STARTUPINFOEX si=new STARTUPINFOEX();si.si.cb=Marshal.SizeOf(typeof(STARTUPINFOEX));si.attributes=attrs;
        StringBuilder command=new StringBuilder(Quote(args[2]));for(int i=3;i<args.Length;i++)command.Append(" "+Quote(args[i]));
        PROCESSINFO pi;Check(CreateProcess(args[2],command,IntPtr.Zero,IntPtr.Zero,false,0x80000|0x08000000,IntPtr.Zero,null,ref si,out pi));
        CloseHandle(pi.thread);CloseHandle(pi.process);Console.WriteLine("{\"pid\":"+pi.pid+"}");Console.Out.Flush();
        // Keep a queryable handle after parents exit; refuse disposal with any
        // descendant alive. stdin EOF does not erase writer evidence.
        while(true) {
          string line=Console.ReadLine();
          if(line=="release") { string status=Inspect(job,args[1]); if(status.Contains("\"active\":0,"))break;Console.WriteLine("busy");Console.Out.Flush(); }
          if(line==null)System.Threading.Thread.Sleep(1000);
        }
      } finally { DeleteProcThreadAttributeList(attrs);Marshal.FreeHGlobal(attrs);Marshal.FreeHGlobal(value);CloseHandle(job); }
      return 0;
    } catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
  }
}
