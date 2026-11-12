import { readFile, writeFile, mkdir, copyFile, chmod } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { build } from "esbuild";
import { existsSync } from "node:fs";
const root = resolve("mobile/android");
const preview = process.argv.includes("--preview");
if (preview && !process.argv.includes("--debug"))
  throw Error(
    "Offline preview fixtures require --debug and cannot be shipped as release.",
  );
const config = JSON.parse(
  await readFile(".jarvis/android-tools/environment.json", "utf8"),
);
await writeFile(
  root + "/local.properties",
  "sdk.dir=" + config.androidHome + "\n",
);
if (!process.argv.includes("--compile-only")) {
  await mkdir(root + "/app/src/main/assets", { recursive: true });
  await build({
    entryPoints: ["mobile/web/app.tsx"],
    plugins: preview
      ? [
          {
            name: "offline-native-preview",
            setup(build) {
              build.onLoad({ filter: /mobile\/web\/link\.ts$/ }, async () => ({
                contents: await readFile(
                  "scripts/mobile-preview-link.ts",
                  "utf8",
                ),
                loader: "ts",
              }));
              build.onLoad(
                { filter: /src\/renderer\/voice\.ts$/ },
                async () => ({
                  contents: await readFile(
                    "scripts/mobile-preview-voice.ts",
                    "utf8",
                  ),
                  loader: "ts",
                }),
              );
              build.onLoad(
                { filter: /mobile\/web\/app\.tsx$/ },
                async (args) => ({
                  contents: (await readFile(args.path, "utf8")).replace(
                    "const saved = window.JarvisNative?.readPairing();",
                    'const saved = JSON.stringify({id:"preview",key:"offline",url:"https://fixture.invalid/",name:"Sultan’s Mac"});',
                  ),
                  loader: "tsx",
                  resolveDir: resolve("mobile/web"),
                }),
              );
            },
          },
        ]
      : [],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "chrome100",
    outfile: root + "/app/src/main/assets/app.js",
  });
  const versionCode = (
    await readFile(root + "/app/build.gradle", "utf8")
  ).match(/versionCode (\d+)/)?.[1];
  if (!versionCode) throw Error("Android version code missing");
  await writeFile(
    root + "/app/src/main/assets/index.html",
    (await readFile("mobile/web/index.html", "utf8")).replace(
      /(app\.js|app\.css|style\.css)/g,
      "$1?build=" + (preview ? versionCode + "-preview-" + Date.now() : versionCode),
    ),
  );
  await copyFile(
    "mobile/web/style.css",
    root + "/app/src/main/assets/style.css",
  );
  await copyFile(
    "assets/brand/jarvis-icon.png",
    root + "/app/src/main/assets/logo.png",
  );
}
const env = {
  ...process.env,
  JAVA_HOME: config.javaHome,
  ANDROID_HOME: config.androidHome,
  ANDROID_USER_HOME: resolve(".jarvis/android-tools/user"),
  GRADLE_USER_HOME: config.gradleHome,
};
const signingPath = resolve(".jarvis/android-tools/test-signing.json");
if (!existsSync(signingPath)) {
  const password = crypto.randomUUID() + crypto.randomUUID(),
    store = resolve(".jarvis/android-tools/jarvis-test.p12");
  execFileSync(
    config.javaHome + "/bin/keytool",
    [
      "-genkeypair",
      "-keystore",
      store,
      "-storetype",
      "PKCS12",
      "-alias",
      "jarvis-test",
      "-storepass:env",
      "JARVIS_STORE_PASSWORD",
      "-keypass:env",
      "JARVIS_STORE_PASSWORD",
      "-keyalg",
      "RSA",
      "-keysize",
      "3072",
      "-validity",
      "3650",
      "-dname",
      "CN=JARVIS Testing",
    ],
    { env: { ...env, JARVIS_STORE_PASSWORD: password }, stdio: "ignore" },
  );
  await chmod(store, 0o600);
  await writeFile(signingPath, JSON.stringify({ store, password }), {
    mode: 0o600,
  });
}
const signing = JSON.parse(await readFile(signingPath, "utf8"));
env.JARVIS_SIGNING_STORE = signing.store;
env.JARVIS_STORE_PASSWORD = signing.password;
const child = spawn(
  config.gradle,
  [
    "--no-daemon",
    "-p",
    root,
    process.argv.includes("--compile-only")
      ? ":app:compileReleaseJavaWithJavac"
      : process.argv.includes("--debug")
        ? ":app:assembleDebug"
        : ":app:assembleRelease",
  ],
  { env, stdio: "inherit" },
);
const code = await new Promise((r, j) => {
  child.on("error", j);
  child.on("exit", r);
});
if (code) process.exit(Number(code));
if (
  !process.argv.includes("--compile-only") &&
  !process.argv.includes("--debug")
) {
  await mkdir("deliverables", { recursive: true });
  await copyFile(
    root + "/app/build/outputs/apk/release/app-release.apk",
    "deliverables/JARVIS-Android-test.apk",
  );
  console.log("Installable test APK: deliverables/JARVIS-Android-test.apk");
}
