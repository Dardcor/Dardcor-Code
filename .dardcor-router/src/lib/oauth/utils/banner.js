import figlet from "figlet";
import gradient from "gradient-string";
import chalkAnimation from "chalk-animation";

export function showBanner() {
  const banner = figlet.textSync("LLM Proxy", {
    font: "ANSI Shadow",
    horizontalLayout: "default",
    verticalLayout: "default",
  });

  console.log("\n" + gradient.pastel.multiline(banner));
  console.log(gradient.cristal("  🚀 OAuth CLI for AI Providers\n"));
}

export function showSimpleBanner() {
  const banner = figlet.textSync("EP CLI", {
    font: "Standard",
    horizontalLayout: "default",
  });
  console.log(gradient.pastel.multiline(banner));
  console.log(gradient.cristal("  OAuth CLI for AI Providers\n"));
}

export async function showSuccess(message) {
  return new Promise((resolve) => {
    const animation = chalkAnimation.rainbow(`\n✨ ${message}\n`);
    setTimeout(() => {
      animation.stop();
      resolve();
    }, 1000);
  });
}

export function showLoading(text) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  
  const interval = setInterval(() => {
    process.stdout.write(`\r${frames[i]} ${text}`);
    i = (i + 1) % frames.length;
  }, 80);

  return {
    stop: () => {
      clearInterval(interval);
      process.stdout.write("\r");
    },
  };
}

