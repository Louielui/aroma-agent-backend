using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class EngineJob
{
    private const string JobName = @"Local\Aroma-Xiangxiang-Phase1-Inference-v1";
    private const uint KillOnClose = 0x2000;
    private const int AlreadyExists = 183;
    private static IntPtr job;

    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimits
    {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveProcesses;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounts
    {
        public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimits
    {
        public BasicLimits Basic;
        public IoCounts Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }

    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool SetInformationJobObject(IntPtr handle, int kind, ref ExtendedLimits limits, uint size);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool AssignProcessToJobObject(IntPtr handle, IntPtr process);
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    private static string Quote(string input)
    {
        var value = new StringBuilder("\"");
        int backslashes = 0;
        foreach (char ch in input)
        {
            if (ch == '\\') { backslashes++; continue; }
            if (ch == '"') value.Append('\\', backslashes + 1);
            value.Append('\\', backslashes).Append(ch);
            backslashes = 0;
        }
        return value.Append('\\', backslashes * 2).Append('"').ToString();
    }

    private static void CloseJob()
    {
        var handle = Interlocked.Exchange(ref job, IntPtr.Zero);
        if (handle != IntPtr.Zero) CloseHandle(handle);
    }

    private static int Main(string[] args)
    {
        if (args.Length == 0 || !System.IO.Path.IsPathRooted(args[0])) return 64;
        job = CreateJobObject(IntPtr.Zero, JobName);
        var created = Marshal.GetLastWin32Error();
        if (job == IntPtr.Zero) return 70;
        try
        {
            if (created == AlreadyExists)
            {
                Console.Error.WriteLine("engine_lease_busy");
                return 75;
            }
            var limits = new ExtendedLimits();
            limits.Basic.Flags = KillOnClose;
            if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))) ||
                !AssignProcessToJobObject(job, GetCurrentProcess()))
            {
                Console.Error.WriteLine("engine_job_setup_failed " + Marshal.GetLastWin32Error());
                return 70;
            }
            var argv = new string[args.Length - 1];
            for (int i = 1; i < args.Length; i++) argv[i - 1] = Quote(args[i]);
            var options = new ProcessStartInfo(args[0], String.Join(" ", argv))
            {
                UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true,
                WorkingDirectory = Environment.CurrentDirectory
            };
            using (var child = Process.Start(options))
            {
                child.StandardInput.Close();
                Console.Error.WriteLine("engine_job_child " + child.Id);
                var control = new Thread(() => {
                    try { Console.OpenStandardInput().ReadByte(); }
                    catch (System.IO.IOException) { }
                    finally { CloseJob(); }
                });
                control.IsBackground = true;
                control.Start();
                child.WaitForExit();
                Console.Error.WriteLine("engine_job_exit " + child.ExitCode);
                return child.ExitCode;
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("engine_job_start_failed " + error.GetType().Name);
            return 70;
        }
        finally { CloseJob(); }
    }
}
