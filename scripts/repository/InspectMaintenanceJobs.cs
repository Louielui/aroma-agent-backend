// Read-only inspection. No job creation, assignment, limits, termination,
// privilege adjustment, service control or filesystem writes.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class InspectMaintenanceJobs {
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint rights,bool inherit,uint pid);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool DuplicateHandle(IntPtr source,IntPtr handle,IntPtr target,out IntPtr copy,uint rights,bool inherit,uint options);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool result);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,IntPtr info,uint length,out uint returned);
  [DllImport("ntdll.dll")] static extern int NtQuerySystemInformation(int kind,IntPtr buffer,int length,out int needed);
  public static string Capture(uint[] pids) {
    if(IntPtr.Size!=8)throw new Exception("x64_required");
    var rows=new List<string>();var processes=new Dictionary<uint,IntPtr>();
    foreach(uint pid in pids) {
      IntPtr process=OpenProcess(0x1040,false,pid);processes[pid]=process;
      bool member=false;bool ok=process!=IntPtr.Zero&&IsProcessInJob(process,IntPtr.Zero,out member);
      rows.Add("{\"pid\":"+pid+",\"membership\":\""+(ok?(member?"some-job":"none"):"unavailable")+"\"}");
    }
    IntPtr buffer=IntPtr.Zero;int size=65536,needed,status;
    try {
      while(true) {
        buffer=Marshal.AllocHGlobal(size);status=NtQuerySystemInformation(64,buffer,size,out needed);
        if(status==0)break;Marshal.FreeHGlobal(buffer);buffer=IntPtr.Zero;
        if(status!=unchecked((int)0xc0000004)||size>=67108864)throw new Exception("handle_inventory_unavailable");
        size=Math.Max(size*2,needed+65536);
      }
      long count=Marshal.ReadIntPtr(buffer).ToInt64();if(count<0||count>(size-16)/40)throw new Exception("handle_inventory_invalid");
      for(int i=0;i<count;i++) {
        IntPtr entry=IntPtr.Add(buffer,16+i*40);long owner=Marshal.ReadIntPtr(entry,8).ToInt64();
        if(owner<1||owner>UInt32.MaxValue||!processes.ContainsKey((uint)owner)||processes[(uint)owner]==IntPtr.Zero)continue;
        IntPtr copy;
        if(!DuplicateHandle(processes[(uint)owner],Marshal.ReadIntPtr(entry,16),GetCurrentProcess(),out copy,4,false,0))continue;
        IntPtr limits=Marshal.AllocHGlobal(144),list=Marshal.AllocHGlobal(65536);uint returned;
        try {
          if(!QueryInformationJobObject(copy,9,limits,144,out returned))continue;
          if(!QueryInformationJobObject(copy,3,list,65536,out returned))continue;
          int assigned=Marshal.ReadInt32(list),actual=Marshal.ReadInt32(list,4);if(actual!=assigned||actual<0||actual>4000)continue;
          var members=new List<string>();foreach(var candidate in processes) {
            bool inside;if(candidate.Value!=IntPtr.Zero&&IsProcessInJob(candidate.Value,copy,out inside)&&inside)members.Add(candidate.Key.ToString());
          }
          if(members.Count==0)continue;
          var active=new List<string>();for(int j=0;j<actual;j++)active.Add(Marshal.ReadIntPtr(list,8+j*8).ToInt64().ToString());
          rows.Add("{\"handleOwnerPid\":"+owner+",\"limitFlags\":"+(uint)Marshal.ReadInt32(limits,16)+",\"confirmedMembers\":["+String.Join(",",members)+"],\"activePids\":["+String.Join(",",active)+"]}");
        } finally {Marshal.FreeHGlobal(limits);Marshal.FreeHGlobal(list);CloseHandle(copy);}
      }
      return "["+String.Join(",",rows)+"]";
    } finally {if(buffer!=IntPtr.Zero)Marshal.FreeHGlobal(buffer);foreach(var p in processes)if(p.Value!=IntPtr.Zero)CloseHandle(p.Value);}
  }
}
