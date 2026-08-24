const form = document.getElementById("publishForm");
const progressCard = document.getElementById("progressCard");
const successCard = document.getElementById("successCard");
const errorCard = document.getElementById("errorCard");
const retryBtn = document.getElementById("retryBtn");
const publishAnotherBtn = document.getElementById("publishAnotherBtn");

let currentId = null;
let pollTimer = null;

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function showOnly(card) {
  [form, progressCard, successCard, errorCard].forEach((el) => el.classList.add("hidden"));
  card.classList.remove("hidden");
}

function setStep(status) {
  const steps = { building: "step-building", placing: "step-placing", live: "step-live" };
  const order = ["building", "placing", "live"];
  const currentIndex = order.indexOf(status);
  order.forEach((key, i) => {
    const el = document.getElementById(steps[key]);
    el.classList.remove("active", "done");
    if (i < currentIndex) el.classList.add("done");
    if (i === currentIndex) el.classList.add("active");
  });
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function pollStatus(id) {
  stopPolling();
  pollTimer = setInterval(async () => {
    const res = await fetch(`/api/publish/${id}/status`);
    const data = await res.json();

    if (data.status === "building" || data.status === "placing") {
      setStep(data.status);
    } else if (data.status === "live") {
      stopPolling();
      const url = `${window.location.origin}/p/${id}`;
      document.getElementById("liveLink").href = url;
      document.getElementById("liveLink").textContent = url;
      document.getElementById("openBtn").href = url;
      showOnly(successCard);
    } else if (data.status === "failed") {
      stopPolling();
      showOnly(errorCard);
    }
  }, 700);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("title").value;
  const blurb = document.getElementById("blurb").value;
  const imageFile = document.getElementById("image").files[0];
  const imageDataUrl = await fileToDataUrl(imageFile);

  showOnly(progressCard);
  setStep("building");

  const res = await fetch("/api/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, blurb, imageDataUrl }),
  });
  const data = await res.json();
  currentId = data.id;
  pollStatus(currentId);
});

retryBtn.addEventListener("click", async () => {
  showOnly(progressCard);
  setStep("building");
  await fetch(`/api/publish/${currentId}/retry`, { method: "POST" });
  pollStatus(currentId);
});

publishAnotherBtn.addEventListener("click", () => {
  form.reset();
  showOnly(form);
});
