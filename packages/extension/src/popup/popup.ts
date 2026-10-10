const versionElement = document.getElementById("version")
if (versionElement) versionElement.textContent = `v${chrome.runtime.getManifest().version}`
