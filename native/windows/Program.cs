using System.Text.Json;
namespace JarvisNative;
static class Program {
    public static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    public static void Emit(object value) { Console.WriteLine(JsonSerializer.Serialize(value, Json)); Console.Out.Flush(); }
    [STAThread]
    static int Main(string[] args) {
        try {
            if (args.FirstOrDefault() == "--wake") return Wake.Run(args.Skip(1).ToArray());
            // One bounded request per process. Never accept a command line or script.
            var buffer = new char[2_000_001]; int total = 0, count;
            while ((count = Console.In.Read(buffer, total, buffer.Length - total)) > 0) {
                total += count; if (total >= buffer.Length) throw new Exception("Native request exceeds limit.");
            }
            using var input = JsonDocument.Parse(new string(buffer, 0, total));
            Emit(Desktop.Run(input.RootElement)); return 0;
        } catch (Exception e) { if(args.FirstOrDefault()=="--wake")Emit(new { type="error", message=e.Message, onDevice=true });else Emit(new { error = "native_rejected", detail = e.Message }); return 1; }
    }
}
