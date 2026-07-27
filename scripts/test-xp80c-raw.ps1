param(
  [string]$PrinterName = ""
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing
Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class KproRawPrinterTest
{
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA
  {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }

  [DllImport("winspool.drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
  private static extern bool OpenPrinter(string name, out IntPtr printer, IntPtr defaults);

  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool ClosePrinter(IntPtr printer);

  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
  private static extern int StartDocPrinter(IntPtr printer, int level, [In] DOCINFOA docInfo);

  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool EndDocPrinter(IntPtr printer);

  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool StartPagePrinter(IntPtr printer);

  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool EndPagePrinter(IntPtr printer);

  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool WritePrinter(IntPtr printer, byte[] data, int count, out int written);

  public static void Send(string printerName, byte[] data)
  {
    IntPtr printer;
    if (!OpenPrinter(printerName, out printer, IntPtr.Zero))
      throw new InvalidOperationException("OpenPrinter failed: " + Marshal.GetLastWin32Error());

    try
    {
      var info = new DOCINFOA {
        pDocName = "K-pro XP-80C RAW test",
        pDataType = "RAW"
      };
      if (StartDocPrinter(printer, 1, info) == 0)
        throw new InvalidOperationException("StartDocPrinter failed: " + Marshal.GetLastWin32Error());
      try
      {
        if (!StartPagePrinter(printer))
          throw new InvalidOperationException("StartPagePrinter failed: " + Marshal.GetLastWin32Error());
        try
        {
          int written;
          if (!WritePrinter(printer, data, data.Length, out written))
            throw new InvalidOperationException("WritePrinter failed: " + Marshal.GetLastWin32Error());
          if (written != data.Length)
            throw new InvalidOperationException("Only " + written + " of " + data.Length + " bytes were written.");
        }
        finally
        {
          EndPagePrinter(printer);
        }
      }
      finally
      {
        EndDocPrinter(printer);
      }
    }
    finally
    {
      ClosePrinter(printer);
    }
  }
}
'@

if ([string]::IsNullOrWhiteSpace($PrinterName)) {
  $PrinterName = (New-Object System.Drawing.Printing.PrinterSettings).PrinterName
}
if ([string]::IsNullOrWhiteSpace($PrinterName)) {
  throw "Default printer not found."
}

$bytes = [System.Collections.Generic.List[byte]]::new()
$bytes.AddRange([byte[]](0x1B, 0x40))                 # ESC @ - initialize
$bytes.AddRange([byte[]](0x1C, 0x2E))                 # FS . - leave Chinese double-byte mode
$bytes.AddRange([byte[]](0x1B, 0x74, 0x11))           # ESC t 17 - CP866 Cyrillic
$bytes.AddRange([byte[]](0x1B, 0x61, 0x01))           # ESC a 1 - center
$encoding = [Text.Encoding]::GetEncoding(866)
$utf8 = [Text.Encoding]::UTF8
$bytes.AddRange($encoding.GetBytes($utf8.GetString([Convert]::FromBase64String("0J/QoNCe0JLQldCg0JrQkCDQmi3Qn9Cg0J4="))))
$bytes.Add(0x0A)
$bytes.AddRange([byte[]](0x1B, 0x61, 0x00))           # ESC a 0 - left
$bytes.AddRange($encoding.GetBytes($utf8.GetString([Convert]::FromBase64String("0KTRgNGD0LrRgtGLINC4INC+0LLQvtGJ0Lg="))))
$bytes.Add(0x0A)
$bytes.AddRange($encoding.GetBytes($utf8.GetString([Convert]::FromBase64String("0JjQotCe0JPQnjogMTIzLDQ1INCh0J7QnA=="))))
$bytes.AddRange([byte[]](0x0A, 0x0A, 0x0A))
$bytes.AddRange([byte[]](0x1D, 0x56, 0x42, 0x00))     # GS V B 0 - cut

[KproRawPrinterTest]::Send($PrinterName, $bytes.ToArray())
Write-Output "RAW_TEST_SENT=$PrinterName"
