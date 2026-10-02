// Prebuilt package owner. .NET Framework 4.x / Windows only.
// All paths are internal owner inputs over private stdio, never MCP parameters.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

namespace AideskWindowsPrototype {
  sealed class Failure : Exception { internal string Kind; internal Failure(string kind) { Kind = kind; } }
  public static class NativeOwner {
    public static int Main() {
      try { Run(); return 0; }
      catch { Console.Error.WriteLine("windows_owner_helper_unavailable"); return 1; }
    }
    const uint READ_CONTROL = 0x20000, READ_ATTRIBUTES = 0x80, DELETE = 0x10000;
    const uint GENERIC_READ = 0x80000000, GENERIC_WRITE = 0x40000000;
    const uint SHARE_READ = 1, SHARE_WRITE = 2, OPEN_EXISTING = 3, CREATE_NEW = 1;
    const uint REPARSE = 0x400, DIRECTORY = 0x10, OPEN_REPARSE = 0x00200000;
    const uint BACKUP_SEMANTICS = 0x02000000, WRITE_THROUGH = 0x80000000;
    const int LIMIT = 1048576;
    static readonly string User = WindowsIdentity.GetCurrent().User.Value;
    static readonly string Instance = Guid.NewGuid().ToString();
    static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 2100000, RecursionLimit = 64 };
    static readonly HashSet<string> Trusted = new HashSet<string>(StringComparer.Ordinal) {
      User, "S-1-5-18", "S-1-5-32-544",
      "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464" // TrustedInstaller, ancestors only.
    };
#if QUALIFICATION_DIAGNOSTICS
    static Dictionary<string,object> TraceState;
    static bool FailCreatedDirectoryReadback;
    static string SidClass(string sid) {
      if (sid == User) return "current_user";
      if (sid == "S-1-5-18") return "system";
      if (sid == "S-1-5-32-544") return "administrators";
      if (sid == "S-1-5-32-545") return "users";
      if (sid == "S-1-5-11") return "authenticated_users";
      if (sid == "S-1-1-0") return "everyone";
      if (sid == "S-1-3-0") return "creator_owner";
      return Trusted.Contains(sid) ? "trusted_installer" : "other";
    }
#endif
    [Conditional("QUALIFICATION_DIAGNOSTICS")]
    static void TraceAt(string stage, params object[] details) {
#if QUALIFICATION_DIAGNOSTICS
      if (TraceState == null) return;
      if (stage == "ancestor_open") TraceState = D("diagnosticOnly", true);
      TraceState["stage"] = stage;
      for (int i = 0; i < details.Length; i += 2) TraceState[(string)details[i]] = details[i+1];
#endif
    }
    [StructLayout(LayoutKind.Sequential)] struct Info {
      public uint Attributes, CreationLow, CreationHigh, AccessLow, AccessHigh, WriteLow, WriteHigh;
      public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes { public int Length; public IntPtr Descriptor; public int Inherit; }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool CreateDirectoryW(string path, IntPtr security);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Info info);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder path, uint size, uint flags);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool GetVolumeInformationW(string root, StringBuilder name, uint n, out uint serial, out uint max, out uint flags, StringBuilder fs, uint f);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool MoveFileExW(string from, string to, uint flags);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetFileInformationByHandle(SafeFileHandle handle, int kind, IntPtr data, uint length);
    [DllImport("advapi32.dll", SetLastError=true)] static extern uint GetSecurityInfo(SafeFileHandle handle, int type, uint parts, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text, uint revision, out IntPtr descriptor, out uint size);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("shlwapi.dll", CharSet=CharSet.Unicode, ExactSpelling=true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    static extern int AssocQueryStringW(uint flags, uint kind, string association, string extra, StringBuilder output, ref uint length);

    // Current-user, read-only lookup of one fixed protocol. No registration,
    // process launch, arbitrary association, registry path or account input.
    static object CodexDefaultAppId(int result, uint length, string value) {
      Need(result == 0 && length >= 2 && length <= 1024 && value != null
        && Regex.IsMatch(value, "\\AOpenAI\\.Codex_[a-z0-9]{13}!App\\z"), "io_unavailable");
      return D("defaultProtocolAppId", value);
    }
    static object ReadCodexDefaultAppId() {
      uint length = 1024; var output = new StringBuilder((int)length);
      // IS_PROTOCOL | NOFIXUPS | NOTRUNCATE; APPID. No machine-default fallback.
      int result = AssocQueryStringW(0x1120, 21, "codex", null, output, ref length);
      return CodexDefaultAppId(result, length, output.ToString());
    }

    static void Need(bool yes, string kind) { if (!yes) throw new Failure(kind); }
    static Failure Error(int code, string exists) {
      return new Failure(code == 2 || code == 3 ? "not_found" : code == 80 || code == 183 ? exists : code == 32 || code == 33 ? "busy" : "io_unavailable");
    }
    static string Long(string path) { return "\\\\?\\" + path; }
    static string PathOf(object raw) {
      string value = raw as string;
      TraceAt("path_shape");
      Need(value != null && value.Length >= 3 && value.Length <= 4096 && Regex.IsMatch(value, "^[A-Za-z]:\\\\"), "unsafe_path");
      TraceAt("path_characters", "inputPathSha256", Hash(Utf8.GetBytes(value)));
      Need(value.IndexOf('/') < 0 && value.IndexOf('\0') < 0 && value.IndexOf(':', 2) < 0, "unsafe_path");
      TraceAt("path_trailing_separator");
      if (value.Length > 3) Need(!value.EndsWith("\\", StringComparison.Ordinal), "unsafe_path");
      string[] parts = value.Substring(3).Split('\\');
      foreach (string p in parts) {
        if (value.Length == 3) break;
        TraceAt("path_component");
        Need(p.Length > 0 && p != "." && p != ".." && !p.EndsWith(".") && !p.EndsWith(" ")
          && !Regex.IsMatch(p, "[<>\"|?*\\x00-\\x1f]")
          && !Regex.IsMatch(p, "^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])($|\\.)", RegexOptions.IgnoreCase), "unsafe_path");
      }
      return char.ToUpperInvariant(value[0]) + value.Substring(1);
    }
    static string Parent(string p) { int at = p.LastIndexOf('\\'); return at == 2 ? p.Substring(0, 3) : p.Substring(0, at); }
    static string Hash(byte[] bytes) { using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); }
    static Dictionary<string,object> D(params object[] pairs) {
      var value = new Dictionary<string,object>(); for (int i = 0; i < pairs.Length; i += 2) value.Add((string)pairs[i], pairs[i+1]); return value;
    }
    static Info Information(SafeFileHandle h) { Info i; if (!GetFileInformationByHandle(h, out i)) throw Error(Marshal.GetLastWin32Error(), "already_exists"); return i; }
    static string Acl(SafeFileHandle h, bool privateMode, bool volumeRoot, bool owned) {
      IntPtr owner, group, dacl, sacl, descriptor;
      uint code = GetSecurityInfo(h, 1, 1 | 4, out owner, out group, out dacl, out sacl, out descriptor);
      if (code != 0) throw Error((int)code, "already_exists");
      try {
        TraceAt("acl_descriptor_present");
        Need(descriptor != IntPtr.Zero && owner != IntPtr.Zero && dacl != IntPtr.Zero, "unsafe_path");
        uint length = GetSecurityDescriptorLength(descriptor); TraceAt("acl_descriptor_length"); Need(length > 0 && length <= 65536, "unsafe_path");
        byte[] bytes = new byte[length]; Marshal.Copy(descriptor, bytes, 0, bytes.Length);
        var sd = new RawSecurityDescriptor(bytes, 0); string sid = sd.Owner.Value;
#if QUALIFICATION_DIAGNOSTICS
        TraceAt("acl_owner", "ownerClass", SidClass(sid), "privateMode", privateMode, "ownedRequired", owned);
#endif
        Need(Trusted.Contains(sid) && (!privateMode && !owned || sid == User), "unsafe_path");
        TraceAt("acl_not_null");
        Need(sd.DiscretionaryAcl != null, "unsafe_path");
        foreach (GenericAce raw in sd.DiscretionaryAcl) {
          TraceAt("acl_ace_shape", "aceType", raw.AceType.ToString(), "aceFlags", (int)raw.AceFlags);
          var ace = raw as CommonAce; Need(ace != null && !ace.IsCallback, "unsafe_path");
          TraceAt("acl_ace_qualifier");
          Need(ace.AceQualifier == AceQualifier.AccessAllowed || ace.AceQualifier == AceQualifier.AccessDenied, "unsafe_path");
          if (ace.AceQualifier != AceQualifier.AccessAllowed) continue;
          bool inheritedOnly = (ace.AceFlags & AceFlags.InheritOnly) != 0;
          string who = ace.SecurityIdentifier.Value;
          bool allowed = who == User || who == "S-1-5-18" || who == "S-1-5-32-544";
#if QUALIFICATION_DIAGNOSTICS
          TraceAt("acl_allow_grant", "trusteeClass", SidClass(who), "aceMaskHex", ((uint)ace.AccessMask).ToString("x8"), "inheritOnly", inheritedOnly);
#endif
          if (privateMode) { TraceAt("acl_private_grant"); Need(allowed || ace.AccessMask == 0, "unsafe_path"); }
          else if (!inheritedOnly && !Trusted.Contains(who)) {
            // Root-volume create-child grants do not authorize deleting an
            // existing ancestor. All deeper ancestors reject any foreign write.
            uint dangerous = volumeRoot ? 0x500d0040u : 0x500d0156u;
            TraceAt("acl_foreign_write", "dangerousMaskHex", dangerous.ToString("x8"), "intersectHex", ((uint)ace.AccessMask & dangerous).ToString("x8"), "volumeRoot", volumeRoot);
            Need(((uint)ace.AccessMask & dangerous) == 0, "unsafe_path");
          }
        }
        return sid;
      } finally { if (descriptor != IntPtr.Zero) LocalFree(descriptor); }
    }
    static Dictionary<string,object> Inspect(SafeFileHandle h, string path, bool directory, bool privateMode, bool owned) {
      Info i = Information(h);
      TraceAt("object_type", "pathSha256", Hash(Utf8.GetBytes(path)), "directoryExpected", directory, "reparse", (i.Attributes & REPARSE) != 0, "isDirectory", (i.Attributes & DIRECTORY) != 0);
      Need((i.Attributes & REPARSE) == 0 && ((i.Attributes & DIRECTORY) != 0) == directory, "unsafe_path");
      if (!directory) { TraceAt("single_link", "links", i.Links); Need(i.Links == 1, "unsafe_path"); }
      var buffer = new StringBuilder(32768); uint n = GetFinalPathNameByHandleW(h, buffer, (uint)buffer.Capacity, 0);
      TraceAt("final_path_result", "returnedLength", n);
      Need(n > 0 && n < buffer.Capacity, "unsafe_path");
      TraceAt("final_path_match", "expectedLength", Long(path).Length, "finalPathSha256", Hash(Utf8.GetBytes(buffer.ToString())), "expectedPathSha256", Hash(Utf8.GetBytes(Long(path))), "inputContainsTilde", path.IndexOf('~') >= 0, "finalContainsTilde", buffer.ToString().IndexOf('~') >= 0);
      Need(String.Equals(buffer.ToString(), Long(path), StringComparison.OrdinalIgnoreCase), "unsafe_path");
      string sid = Acl(h, privateMode, path.Length == 3, owned);
      return D("device", i.Volume.ToString(), "inode", (((ulong)i.IndexHigh << 32) | i.IndexLow).ToString(),
        "owner", sid, "born", (((ulong)i.CreationHigh << 32) | i.CreationLow).ToString());
    }
    static SafeFileHandle Open(string path, bool directory, uint access, uint share, uint disposition, IntPtr security, string exists) {
      uint flags = OPEN_REPARSE | (directory ? BACKUP_SEMANTICS : disposition == CREATE_NEW ? WRITE_THROUGH : 0);
      SafeFileHandle h = CreateFileW(Long(path), access | READ_CONTROL | READ_ATTRIBUTES, share, security, disposition, flags, IntPtr.Zero);
      if (h.IsInvalid) { int code = Marshal.GetLastWin32Error(); h.Dispose(); throw Error(code, exists); }
      return h;
    }
    sealed class Chain : IDisposable {
      internal List<SafeFileHandle> Handles = new List<SafeFileHandle>();
      internal Dictionary<string,object> Identity;
      internal string Path;
      public void Dispose() { for (int i=Handles.Count-1; i>=0; --i) Handles[i].Dispose(); }
    }
    static Chain Directories(string path, bool privateMode, bool owned) {
      var chain = new Chain { Path = path };
      try {
        uint serial, max, flags; var fs = new StringBuilder(32);
        Need(GetVolumeInformationW(path.Substring(0,3), null, 0, out serial, out max, out flags, fs, 32)
          && fs.ToString() == "NTFS", "unsupported_filesystem");
        string current = path.Substring(0,3);
        var paths = new List<string> { current };
        if (path.Length > 3) foreach (string part in path.Substring(3).Split('\\')) { current = current.Length == 3 ? current + part : current + "\\" + part; paths.Add(current); }
        int depth = 0;
        foreach (string p in paths) {
          TraceAt("ancestor_open", "ancestorDepth", depth++, "pathSha256", Hash(Utf8.GetBytes(p)));
          // No FILE_SHARE_DELETE: live transaction retains ancestor identities.
          var h = Open(p, true, 0, SHARE_READ | SHARE_WRITE, OPEN_EXISTING, IntPtr.Zero, "already_exists"); chain.Handles.Add(h);
          chain.Identity = Inspect(h, p, true, p == path && privateMode, p == path && owned);
        }
        return chain;
      } catch { chain.Dispose(); throw; }
    }
    sealed class PrivateSecurity : IDisposable {
      IntPtr Descriptor; internal IntPtr Pointer;
      internal PrivateSecurity(bool directory) {
        string inherit = directory ? "OICI" : "";
        string sddl = "O:" + User + "D:P(A;" + inherit + ";FA;;;" + User + ")(A;" + inherit + ";FA;;;SY)(A;" + inherit + ";FA;;;BA)";
        uint length; if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, out Descriptor, out length)) throw Error(Marshal.GetLastWin32Error(), "already_exists");
        var sa = new SecurityAttributes { Length=Marshal.SizeOf(typeof(SecurityAttributes)), Descriptor=Descriptor, Inherit=0 };
        Pointer = Marshal.AllocHGlobal(sa.Length); Marshal.StructureToPtr(sa, Pointer, false);
      }
      public void Dispose() { if (Pointer != IntPtr.Zero) Marshal.FreeHGlobal(Pointer); if (Descriptor != IntPtr.Zero) LocalFree(Descriptor); }
    }
    static object DirectoryOperation(string path, string op, bool privateMode, bool owned) {
      if (op == "inspect") using (var c = Directories(path, privateMode, owned)) return D("path", path, "identity", c.Identity);
      Need(path.Length > 3, "unsafe_path");
      using (var parent = Directories(Parent(path), op == "mkdir_exclusive", false)) {
        bool made; using (var security = new PrivateSecurity(true)) made = CreateDirectoryW(Long(path), security.Pointer);
        if (!made) {
          int code = Marshal.GetLastWin32Error();
          if (!(op == "ensure" && code == 183)) throw Error(code, "already_exists");
        }
        // Never repair/adopt unsafe pre-existing ACLs, including ensure's race.
        // Once creation succeeded, failed readback is an unknown mutation,
        // never a known-before-write denial or permission to recreate it.
        try {
#if QUALIFICATION_DIAGNOSTICS
          if (made && FailCreatedDirectoryReadback) throw new Failure("io_unavailable");
#endif
          using (var c = Directories(path, true, true)) return D("path", path, "identity", c.Identity);
        } catch {
          if (made) throw new Failure("mutation_unknown");
          throw;
        }
      }
    }
    static Dictionary<string,object> Read(string path, int limit) {
      Need(limit > 0 && limit <= LIMIT, "invalid_limit");
      using (var h = Open(path, false, GENERIC_READ, SHARE_READ, OPEN_EXISTING, IntPtr.Zero, "already_exists")) {
        var identity = Inspect(h, path, false, true, true); Info before = Information(h);
        ulong size = ((ulong)before.SizeHigh << 32) | before.SizeLow; Need(size <= (ulong)limit, "invalid_json");
        byte[] bytes = new byte[(int)size];
        using (var stream = new FileStream(h, FileAccess.Read)) {
          int at=0; while (at<bytes.Length) { int n=stream.Read(bytes, at, bytes.Length-at); Need(n>0, "file_changed"); at+=n; }
          Need(stream.ReadByte() == -1, "file_changed"); Info after = Information(h);
          Need(before.SizeHigh == after.SizeHigh && before.SizeLow == after.SizeLow && before.WriteHigh == after.WriteHigh && before.WriteLow == after.WriteLow, "file_changed");
          Inspect(h, path, false, true, true);
          return D("base64", Convert.ToBase64String(bytes), "sha256", Hash(bytes), "identity", identity);
        }
      }
    }
    static bool Same(Dictionary<string,object> a, Dictionary<string,object> b) {
      foreach (string k in new [] { "device", "inode", "owner", "born" }) if (!Object.Equals(a[k], b[k])) return false;
      return true;
    }
    static void DeleteExact(string path, Dictionary<string,object> identity) {
      using (var h = Open(path, false, DELETE, SHARE_READ, OPEN_EXISTING, IntPtr.Zero, "already_exists")) {
        Need(Same(Inspect(h, path, false, true, true), identity), "file_changed");
        IntPtr data = Marshal.AllocHGlobal(1);
        try { Marshal.WriteByte(data, 1); if (!SetFileInformationByHandle(h, 4, data, 1)) throw Error(Marshal.GetLastWin32Error(), "already_exists"); }
        finally { Marshal.FreeHGlobal(data); }
      }
    }
    static Dictionary<string,object> NewFile(string path, byte[] bytes, string exists) {
      using (var security = new PrivateSecurity(false))
      using (var h = Open(path, false, GENERIC_WRITE, SHARE_READ, CREATE_NEW, security.Pointer, exists)) {
        var identity = Inspect(h, path, false, true, true);
        using (var stream = new FileStream(h, FileAccess.Write)) { stream.Write(bytes,0,bytes.Length); stream.Flush(true); }
        return identity;
      }
    }
    static object Mutate(string path, string op, byte[] bytes, string expected) {
      using (var parent = Directories(Parent(path), true, true)) {
        string lockPath = path + ".lock", temp = null;
        var lockIdentity = NewFile(lockPath, Utf8.GetBytes("{\"format\":1,\"owner\":\""+Guid.NewGuid().ToString()+"\"}\n"), "busy");
        Dictionary<string,object> tempIdentity = null;
        bool commitStarted = false, preserve = false;
        try {
          Dictionary<string,object> old = null;
          try { old = Read(path, LIMIT); } catch (Failure f) { if (f.Kind != "not_found") throw; }
          if (op == "write") Need(old == null, "already_exists");
          else { Need(old != null, "not_found"); Need((string)old["sha256"] == expected, "file_changed"); }
          if (op == "remove") {
            commitStarted = true; DeleteExact(path, (Dictionary<string,object>)old["identity"]);
            return D("removed", true, "sha256", expected);
          }
          temp = path + ".tmp-" + Guid.NewGuid().ToString("N"); tempIdentity = NewFile(temp, bytes, "already_exists");
          if (old != null) {
            var again = Read(path, LIMIT);
            Need((string)again["sha256"] == expected && Same((Dictionary<string,object>)old["identity"], (Dictionary<string,object>)again["identity"]), "file_changed");
          }
          commitStarted = true;
          if (!MoveFileExW(Long(temp), Long(path), op == "write" ? 8u : 9u)) {
            int code = Marshal.GetLastWin32Error();
            if (op == "write" && (code == 80 || code == 183)) { commitStarted = false; throw new Failure("already_exists"); }
            throw Error(code, "already_exists");
          }
          temp = null; var result = Read(path, LIMIT); Need((string)result["sha256"] == Hash(bytes), "file_changed");
          return result;
        } catch {
          if (commitStarted) { preserve = true; throw new Failure("mutation_unknown"); }
          throw;
        } finally {
          // Unknown publication/delete leaves the original lock for exact
          // reconciliation. No timestamp/PID-based stale-lock reclamation.
          if (!preserve) {
            try { if (temp != null && tempIdentity != null) DeleteExact(temp, tempIdentity); }
            finally { try { DeleteExact(lockPath, lockIdentity); } catch { throw new Failure("mutation_unknown"); } }
          }
        }
      }
    }
    static object ReadLocked(string path, int limit) {
      using (var parent = Directories(Parent(path), true, true)) {
        string lockPath = path + ".lock";
        var lockIdentity = NewFile(lockPath, Utf8.GetBytes("{\"format\":1,\"owner\":\""+Guid.NewGuid().ToString()+"\"}\n"), "busy");
        try { return Read(path, limit); }
        finally { try { DeleteExact(lockPath, lockIdentity); } catch { throw new Failure("mutation_unknown"); } }
      }
    }
    static string Text(Dictionary<string,object> r, string key) { object v; return r.TryGetValue(key, out v) ? v as string : null; }
    static object Dispatch(Dictionary<string,object> r) {
      string op = Text(r, "op"); Need(op != null, "invalid_request");
#if QUALIFICATION_DIAGNOSTICS
      if (op == "diagnose_codex_default_app_id") {
        Need(r.Count == 3 && r.ContainsKey("case"), "invalid_request");
        string example = "OpenAI.Codex_abcdefghijklm!App";
        switch (Text(r, "case")) {
          case "valid": return CodexDefaultAppId(0, (uint)example.Length + 1, example);
          case "native_error": return CodexDefaultAppId(-1, (uint)example.Length + 1, example);
          case "oversized": return CodexDefaultAppId(0, 1025, example);
          case "truncated": return CodexDefaultAppId(0, 2, "O");
          case "other_app": return CodexDefaultAppId(0, 10, "Other!App");
          case "trailing_newline": return CodexDefaultAppId(0, (uint)example.Length + 2, example + "\n");
          default: throw new Failure("invalid_request");
        }
      }
      if (op == "diagnose_mkdir_readback_failure") {
        try { FailCreatedDirectoryReadback = true; return DirectoryOperation(PathOf(Text(r,"path")), "mkdir_exclusive", true, true); }
        finally { FailCreatedDirectoryReadback = false; }
      }
      if (op == "diagnose_ensure") {
        TraceState = D("stage", "dispatch", "diagnosticOnly", true);
        try { DirectoryOperation(PathOf(Text(r,"path")), "ensure", true, true); return D("completed", true, "guardChanged", false, "diagnostic", TraceState); }
        catch (Failure f) { return D("completed", false, "kind", f.Kind, "guardChanged", false, "diagnostic", TraceState); }
        finally { TraceState = null; }
      }
#endif
      if (op == "ping") return D("instanceId", Instance, "pid", Process.GetCurrentProcess().Id, "platform", "win32", "filesystem", "NTFS", "durability", "file_flush_and_move_write_through");
      if (op == "codex_default_app_id") {
        Need(r.Count == 2, "invalid_request");
        return ReadCodexDefaultAppId();
      }
      string path = PathOf(Text(r,"path"));
      if (op == "inspect") return DirectoryOperation(path,op,r.ContainsKey("privateMode") && Object.Equals(r["privateMode"],true),r.ContainsKey("owned") && Object.Equals(r["owned"],true));
      if (op == "ensure" || op == "mkdir_exclusive") return DirectoryOperation(path,op,true,true);
      if (op == "read") using (var parent = Directories(Parent(path),true,true)) return Read(path, r.ContainsKey("limit") ? Convert.ToInt32(r["limit"]) : 65536);
      if (op == "read_locked") return ReadLocked(path, r.ContainsKey("limit") ? Convert.ToInt32(r["limit"]) : 65536);
      Need(op == "write" || op == "replace" || op == "remove", "invalid_request");
      string expected = Text(r,"expectedSha256");
      if (op != "write") Need(expected != null && Regex.IsMatch(expected,"^[a-f0-9]{64}$"),"invalid_expected_digest");
      byte[] bytes = null;
      if (op != "remove") { try { bytes=Convert.FromBase64String(Text(r,"base64")); } catch { throw new Failure("invalid_json"); } Need(bytes.Length <= LIMIT,"invalid_json"); }
      return Mutate(path,op,bytes,expected);
    }
    public static void Run() {
      Console.InputEncoding=Utf8; Console.OutputEncoding=Utf8;
      Console.WriteLine(Json.Serialize(D("protocol",1,"ready",true,"instanceId",Instance,"pid",Process.GetCurrentProcess().Id)));
      string line;
      while ((line=Console.ReadLine()) != null) {
        string id=null;
        try {
          Need(line.Length <= 1500000,"invalid_request"); var r=Json.DeserializeObject(line) as Dictionary<string,object>;
          Need(r != null,"invalid_request"); id=Text(r,"id"); Need(id != null && Regex.IsMatch(id,"^[a-f0-9-]{36}$"),"invalid_request");
          Console.WriteLine(Json.Serialize(D("id",id,"ok",true,"result",Dispatch(r))));
        } catch (Failure f) { Console.WriteLine(Json.Serialize(D("id",id,"ok",false,"kind",f.Kind))); }
          catch { Console.WriteLine(Json.Serialize(D("id",id,"ok",false,"kind","io_unavailable"))); }
      }
    }
  }
}
