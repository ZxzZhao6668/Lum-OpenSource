using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Windows.Forms;

internal static class InstallUpdate
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length != 4) return 1;
        bool committed = false;
        try
        {
            using (var parent = Process.GetProcessById(int.Parse(args[0])))
            using (var lockedFile = File.Open(args[1], FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var hash = SHA256.Create())
            {
                string digest = BitConverter.ToString(hash.ComputeHash(lockedFile)).Replace("-", "");
                if (!string.Equals(digest, args[2], StringComparison.OrdinalIgnoreCase))
                    throw new IOException("安装包校验失败，请重新下载。");
                Console.WriteLine("LUM_INSTALLER_READY");
                Console.Out.Flush();
                if (Console.ReadLine() != "install") return 1;
                committed = true;
                if (!parent.WaitForExit(90000)) throw new IOException("Lum 尚未退出。");
                // NSIS consumes the remainder of the raw command line after /D=, including spaces.
                var info = new ProcessStartInfo(args[1], "/S --updated --force-run /D=" + Path.GetDirectoryName(args[3]));
                info.UseShellExecute = true;
                using (var installer = Process.Start(info))
                {
                    installer.WaitForExit();
                    if (installer.ExitCode != 0) throw new IOException("安装程序退出码 " + installer.ExitCode);
                }
            }
            return 0;
        }
        catch (Exception error)
        {
            if (!committed) { Console.Error.WriteLine(error.Message); return 1; }
            MessageBox.Show("更新未完成。请在「关于」中重试。\n" + error.Message, "Lum", MessageBoxButtons.OK, MessageBoxIcon.Error);
            if (File.Exists(args[3])) Process.Start(new ProcessStartInfo(args[3]) { UseShellExecute = true });
            return 1;
        }
    }
}
