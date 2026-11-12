import Foundation
import AVFoundation
import Darwin

func emit(_ event: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject:event, options:[.sortedKeys]) else { return }
    FileHandle.standardOutput.write(data + Data([10]))
}
func matchesWakePhrase(_ text:String) -> Bool {
    let words=text.lowercased().components(separatedBy:CharacterSet.letters.inverted).filter{ !$0.isEmpty }
    return words.count >= 2 && zip(words,words.dropFirst()).contains{ $0 == "hey" && $1 == "jarvis" }
}
if let flag=CommandLine.arguments.firstIndex(of:"--test-phrase"),CommandLine.arguments.count>flag+1 {
    emit(["match":matchesWakePhrase(CommandLine.arguments[flag+1])]);exit(0)
}
typealias ModelNew = @convention(c) (UnsafePointer<CChar>) -> UnsafeMutableRawPointer?
typealias FreeObject = @convention(c) (UnsafeMutableRawPointer) -> Void
typealias FindWord = @convention(c) (UnsafeMutableRawPointer,UnsafePointer<CChar>) -> Int32
typealias RecNew = @convention(c) (UnsafeMutableRawPointer,Float,UnsafePointer<CChar>) -> UnsafeMutableRawPointer?
typealias AcceptAudio = @convention(c) (UnsafeMutableRawPointer,UnsafePointer<Float>,Int32) -> Int32
typealias GetResult = @convention(c) (UnsafeMutableRawPointer) -> UnsafePointer<CChar>?
typealias SetInt = @convention(c) (UnsafeMutableRawPointer,Int32) -> Void
typealias SetLog = @convention(c) (Int32) -> Void

final class OfflineModel {
    var library:UnsafeMutableRawPointer
    var model:UnsafeMutableRawPointer
    var recognizer:UnsafeMutableRawPointer
    let accept:AcceptAudio
    let result:GetResult
    let recFree:FreeObject
    let modelFree:FreeObject
    init() throws {
        let root=URL(fileURLWithPath:CommandLine.arguments[0]).deletingLastPathComponent()
        guard let library=dlopen(root.appendingPathComponent("libvosk.dylib").path,RTLD_NOW) else { throw NSError(domain:"JARVIS",code:1,userInfo:[NSLocalizedDescriptionKey:"Bundled offline speech runtime could not be loaded."]) }
        self.library=library
        func load<T>(_ name:String,_ type:T.Type)->T { guard let address=dlsym(library,name) else { emit(["type":"error","message":"Missing local runtime symbol: \(name)"]);exit(2) };return unsafeBitCast(address,to:type) }
        load("vosk_set_log_level",SetLog.self)(-1)
        let modelNew=load("vosk_model_new",ModelNew.self)
        let findWord=load("vosk_model_find_word",FindWord.self)
        let recNew=load("vosk_recognizer_new_grm",RecNew.self)
        self.accept=load("vosk_recognizer_accept_waveform_f",AcceptAudio.self)
        self.result=load("vosk_recognizer_result",GetResult.self)
        self.recFree=load("vosk_recognizer_free",FreeObject.self)
        self.modelFree=load("vosk_model_free",FreeObject.self)
        guard let model=root.appendingPathComponent("wake-model").path.withCString({modelNew($0)}) else {throw NSError(domain:"JARVIS",code:3,userInfo:[NSLocalizedDescriptionKey:"Bundled offline English model is missing or invalid."])}
        self.model=model
        guard "jarvis".withCString({findWord(model,$0)}) >= 0 else {throw NSError(domain:"JARVIS",code:4,userInfo:[NSLocalizedDescriptionKey:"The local model does not contain the wake name."])}
        guard let recognizer="[\"hey jarvis\", \"hey travis\", \"hey charles\", \"hey service\", \"hey there\", \"hi jarvis\", \"hello jarvis\", \"hey jerry\", \"hey harvey\", \"[unk]\"]".withCString({recNew(model,16000,$0)}) else {throw NSError(domain:"JARVIS",code:5,userInfo:[NSLocalizedDescriptionKey:"Could not create local wake grammar."])}
        self.recognizer=recognizer
        load("vosk_recognizer_set_words",SetInt.self)(recognizer,1)
    }
    func process(_ samples:UnsafePointer<Float>,count:Int)->(matched:Bool,hey:Bool,jarvis:Bool)? {
        let pcm=UnsafeBufferPointer(start:samples,count:count).map{ $0 * 32768 }
        let endpoint=pcm.withUnsafeBufferPointer{ accept(recognizer,$0.baseAddress!,Int32(count)) }
        guard endpoint==1, let raw=result(recognizer),let data=String(cString:raw).data(using:.utf8),let json=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any] else {return nil}
        let text=json["text"] as? String ?? ""
        let words=(json["result"] as? [[String:Any]] ?? []).filter{["hey","jarvis"].contains($0["word"] as? String ?? "")}
        let confidence=words.isEmpty ? 0 : words.reduce(0.0){$0+($1["conf"] as? Double ?? 0)}/Double(words.count)
        return (matchesWakePhrase(text) && confidence>=0.7,text.contains("hey"),text.contains("jarvis"))
    }
    deinit {recFree(recognizer);modelFree(model);dlclose(library)}
}
final class WakeListener {
    let engine=AVAudioEngine()
    let queue=DispatchQueue(label:"com.sultan.jarvis.local-wake")
    let capacity=DispatchSemaphore(value:4)
    var model:OfflineModel?
    var fired=false
    var tapInstalled=false
    func start() {
        do {model=try OfflineModel()} catch {emit(["type":"error","message":error.localizedDescription]);exit(6)}
        if CommandLine.arguments.contains("--probe") {emit(["engine":"Vosk","onDeviceSupported":true,"jarvisInVocabulary":true]);exit(0)}
        if let flag=CommandLine.arguments.firstIndex(of:"--file"),CommandLine.arguments.count>flag+1 {
            do {
                let file=try AVAudioFile(forReading:URL(fileURLWithPath:CommandLine.arguments[flag+1]))
                guard file.processingFormat.sampleRate==16000,file.processingFormat.channelCount==1,file.length<480000,
                      let buffer=AVAudioPCMBuffer(pcmFormat:file.processingFormat,frameCapacity:AVAudioFrameCount(file.length)) else {throw NSError(domain:"JARVIS",code:10,userInfo:[NSLocalizedDescriptionKey:"Test file must be mono 16 kHz, under 30 seconds."])}
                try file.read(into:buffer)
                var detected=false
                if let samples=buffer.floatChannelData?[0],let model=model {
                    var offset=0
                    while offset<Int(buffer.frameLength) {let count=min(1600,Int(buffer.frameLength)-offset);if model.process(samples.advanced(by:offset),count:count)?.matched==true{detected=true};offset += count}
                    let silence=[Float](repeating:0,count:1600)
                    silence.withUnsafeBufferPointer { pointer in for _ in 0..<20 {if model.process(pointer.baseAddress!,count:1600)?.matched==true{detected=true}} }
                }
                emit(["fileDetected":detected,"engine":"Vosk"]);exit(detected ? 0 : 10)
            }catch{emit(["type":"error","message":error.localizedDescription]);exit(11)}
        }
        AVCaptureDevice.requestAccess(for:.audio) {allowed in DispatchQueue.main.async {
            guard allowed else {emit(["type":"error","message":"Microphone permission is required for local wake listening."]);exit(7)}
            self.capture()
        }}
    }
    func capture() {
        let input=engine.inputNode;let format=input.outputFormat(forBus:0)
        guard format.sampleRate>0,format.channelCount>0,
              let outputFormat=AVAudioFormat(commonFormat:.pcmFormatFloat32,sampleRate:16000,channels:1,interleaved:false),
              let converter=AVAudioConverter(from:format,to:outputFormat) else {emit(["type":"error","message":"No usable local microphone format."]);exit(8)}
        var frames=0
        input.installTap(onBus:0,bufferSize:2048,format:format) {buffer,_ in
            guard self.capacity.wait(timeout:.now()) == .success else {return}
            let count=AVAudioFrameCount(ceil(Double(buffer.frameLength)*16000/format.sampleRate)+256)
            guard let output=AVAudioPCMBuffer(pcmFormat:outputFormat,frameCapacity:count) else {self.capacity.signal();return}
            var supplied=false;var error:NSError?
            converter.convert(to:output,error:&error) {_,status in
                if supplied {status.pointee = .noDataNow;return nil}
                supplied=true;status.pointee = .haveData;return buffer
            }
            guard error==nil,output.frameLength>0 else {self.capacity.signal();return}
            self.queue.async {
                defer {self.capacity.signal()}
                guard !self.fired,let model=self.model,let samples=output.floatChannelData?[0] else {return}
                let n=Int(output.frameLength);frames += n
                if frames>=48000 {
                    frames=0;var sum=0.0
                    for i in 0..<n {let x=Double(samples[i]);sum += x*x}
                    emit(["type":"audio","rms":sqrt(sum/Double(n))])
                }
                if let result=model.process(samples,count:n) {
                    emit(["type":"candidate","heardHey":result.hey,"heardJarvis":result.jarvis])
                    if result.matched {
                        self.fired=true
                        emit(["type":"wake","phrase":"Hey JARVIS","onDevice":true,"engine":"Vosk"])
                        DispatchQueue.main.async {self.shutdown();exit(0)}
                    }
                }
            }
        }
        tapInstalled=true
        do {engine.prepare();try engine.start();emit(["type":"ready","onDevice":true,"engine":"Vosk"])}catch{emit(["type":"error","message":"Local microphone capture failed: \(error.localizedDescription)"]);shutdown();exit(9)}
    }
    func shutdown(){engine.stop();if tapInstalled{engine.inputNode.removeTap(onBus:0);tapInstalled=false};queue.sync{self.model=nil}}
}
let listener=WakeListener()
var sources:[DispatchSourceSignal]=[]
for value in [SIGTERM,SIGINT] {signal(value,SIG_IGN);let source=DispatchSource.makeSignalSource(signal:value,queue:.main);source.setEventHandler{listener.shutdown();exit(0)};source.resume();sources.append(source)}
listener.start();RunLoop.main.run()
