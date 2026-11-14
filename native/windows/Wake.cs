using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using Vosk;
namespace JarvisNative;
static class Wake {
    [StructLayout(LayoutKind.Sequential,Pack=2)]struct WaveFormat {public ushort Format,Channels;public uint SamplesPerSecond,BytesPerSecond;public ushort BlockAlign,BitsPerSample,Extra;}
    [StructLayout(LayoutKind.Sequential)]struct WaveHeader {public IntPtr Data;public uint Length,Recorded;public UIntPtr User;public uint Flags,Loops;public IntPtr Next;public UIntPtr Reserved;}
    static bool Phrase(string json) {
        using var doc=JsonDocument.Parse(json);var root=doc.RootElement;
        if(!root.TryGetProperty("result",out var words)||words.ValueKind!=JsonValueKind.Array)return false;
        var tokens=words.EnumerateArray().ToArray();
        for(int i=1;i<tokens.Length;i++)if(tokens[i-1].GetProperty("word").GetString()=="hey"&&tokens[i].GetProperty("word").GetString()=="jarvis"&&tokens[i-1].GetProperty("conf").GetDouble()>=.7&&tokens[i].GetProperty("conf").GetDouble()>=.7)return true;
        return false;
    }
    static VoskRecognizer Recognizer(Model model) {var r=new VoskRecognizer(model,16000,"[\"hey jarvis\", \"hey travis\", \"hey charles\", \"hey service\", \"hey there\", \"hi jarvis\", \"hello jarvis\", \"hey jerry\", \"hey harvey\", \"[unk]\"]");r.SetWords(true);return r;}
    public static int Run(string[] args) {
        // Restrict native dependency search to the packaged app and Windows system DLLs.
        if(!SetDefaultDllDirectories(0x00000800|0x00000400|0x00000200))throw new Exception("Cannot restrict native library search.");
        AddDllDirectory(AppContext.BaseDirectory);
        var native=Path.Combine(AppContext.BaseDirectory,"runtimes","win-x64","native");if(Directory.Exists(native))AddDllDirectory(native);
        Vosk.Vosk.SetLogLevel(-1);
        var modelPath=Path.Combine(AppContext.BaseDirectory,"wake-model");
        if(!File.Exists(Path.Combine(modelPath,"am","final.mdl")))throw new Exception("Offline wake model is missing.");
        using var model=new Model(modelPath);
        if(args.FirstOrDefault()=="--probe") {using var probe=Recognizer(model);Program.Emit(new{type="ready",onDevice=true,engine="Vosk",sampleRate=16000});return 0;}
        if(args.FirstOrDefault()=="--file") {
            if(args.Length!=2)throw new Exception("Supply one local test WAV.");
            using var reader=new BinaryReader(File.OpenRead(args[1]));
            if(new string(reader.ReadChars(4))!="RIFF")throw new Exception("Expected RIFF WAV.");reader.ReadUInt32();if(new string(reader.ReadChars(4))!="WAVE")throw new Exception("Expected WAV.");
            byte[]? pcm=null;bool format=false;
            while(reader.BaseStream.Position+8<=reader.BaseStream.Length){var kind=new string(reader.ReadChars(4));var length=reader.ReadUInt32();if(length>960000||reader.BaseStream.Position+length>reader.BaseStream.Length)throw new Exception("Bounded WAV required (30 seconds maximum).");var bytes=reader.ReadBytes((int)length);if((length&1)!=0)reader.ReadByte();if(kind=="fmt ")format=bytes.Length>=16&&BitConverter.ToUInt16(bytes,0)==1&&BitConverter.ToUInt16(bytes,2)==1&&BitConverter.ToUInt32(bytes,4)==16000&&BitConverter.ToUInt16(bytes,14)==16;if(kind=="data")pcm=bytes;}
            if(!format||pcm==null)throw new Exception("Expected PCM 16 kHz mono 16-bit WAV.");
            using var recognizer=Recognizer(model);bool wake=false;
            for(int i=0;i<pcm.Length;i+=3200){var block=pcm.Skip(i).Take(3200).ToArray();if(recognizer.AcceptWaveform(block,block.Length))wake|=Phrase(recognizer.Result());}wake|=Phrase(recognizer.FinalResult());
            Program.Emit(new{type=wake?"wake":"no_wake",onDevice=true});return wake?0:2;
        }
        using var speech=Recognizer(model);
        var formatPcm=new WaveFormat{Format=1,Channels=1,SamplesPerSecond=16000,BytesPerSecond=32000,BlockAlign=2,BitsPerSample=16};
        // CALLBACK_EVENT keeps all waveIn calls on this thread. Calling waveIn
        // functions from waveInProc is forbidden and can deadlock the driver.
        using var audioReady=new AutoResetEvent(false);
        var code=waveInOpen(out var input,unchecked((uint)-1),ref formatPcm,audioReady.SafeWaitHandle.DangerousGetHandle(),UIntPtr.Zero,0x50000);
        if(code!=0)throw new Exception("Microphone is unavailable. Check Windows microphone privacy and selected input device. Code "+code);
        var headers=new List<IntPtr>();
        try {
            for(int i=0;i<4;i++) {var h=new WaveHeader{Data=Marshal.AllocHGlobal(3200),Length=3200};var ptr=Marshal.AllocHGlobal(Marshal.SizeOf<WaveHeader>());Marshal.StructureToPtr(h,ptr,false);headers.Add(ptr);if(waveInPrepareHeader(input,ptr,(uint)Marshal.SizeOf<WaveHeader>())!=0||waveInAddBuffer(input,ptr,(uint)Marshal.SizeOf<WaveHeader>())!=0)throw new Exception("Could not prepare microphone.");}
            if(waveInStart(input)!=0)throw new Exception("Could not start microphone.");
            Program.Emit(new{type="ready",onDevice=true,engine="Vosk",sampleRate=16000});
            while(true) {
                if(!audioReady.WaitOne(10000))throw new Exception("Microphone stopped delivering audio.");
                foreach(var ptr in headers) {
                    var h=Marshal.PtrToStructure<WaveHeader>(ptr);
                    if((h.Flags&1)==0)continue; // WHDR_DONE; the driver has released this buffer.
                    if(h.Recorded>h.Length||(h.Recorded&1)!=0)throw new Exception("Invalid microphone buffer length.");
                    var block=new byte[h.Recorded];if(block.Length>0)Marshal.Copy(h.Data,block,0,block.Length);
                    if(block.Length>0&&speech.AcceptWaveform(block,block.Length)&&Phrase(speech.Result())){Program.Emit(new{type="wake",onDevice=true});return 0;}
                    if(waveInAddBuffer(input,ptr,(uint)Marshal.SizeOf<WaveHeader>())!=0)throw new Exception("Could not requeue microphone buffer.");
                }
            }
        }finally{
            waveInReset(input);
            foreach(var ptr in headers){
                // If the driver refuses to release a prepared buffer, retain its
                // memory until process exit instead of freeing a live native pointer.
                if(waveInUnprepareHeader(input,ptr,(uint)Marshal.SizeOf<WaveHeader>())==0){Marshal.FreeHGlobal(Marshal.PtrToStructure<WaveHeader>(ptr).Data);Marshal.FreeHGlobal(ptr);}
            }
            if(waveInClose(input)!=0)audioReady.SafeWaitHandle.SetHandleAsInvalid();
            GC.KeepAlive(audioReady);
        }
    }

    [DllImport("kernel32.dll",SetLastError=true)]static extern bool SetDefaultDllDirectories(uint flags);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr AddDllDirectory(string path);
    [DllImport("winmm.dll")]static extern uint waveInOpen(out IntPtr handle,uint device,ref WaveFormat format,IntPtr callback,UIntPtr instance,uint flags);
    [DllImport("winmm.dll")]static extern uint waveInPrepareHeader(IntPtr handle,IntPtr header,uint size);
    [DllImport("winmm.dll")]static extern uint waveInUnprepareHeader(IntPtr handle,IntPtr header,uint size);
    [DllImport("winmm.dll")]static extern uint waveInAddBuffer(IntPtr handle,IntPtr header,uint size);
    [DllImport("winmm.dll")]static extern uint waveInStart(IntPtr handle);
    [DllImport("winmm.dll")]static extern uint waveInReset(IntPtr handle);
    [DllImport("winmm.dll")]static extern uint waveInClose(IntPtr handle);
}
