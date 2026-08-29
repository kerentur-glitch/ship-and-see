const form = document.getElementById("publishForm");
const progressCard = document.getElementById("progressCard");
const successCard = document.getElementById("successCard");
const errorCard = document.getElementById("errorCard");
const retryBtn = document.getElementById("retryBtn");
const editBtn = document.getElementById("editBtn");
const publishAnotherBtn = document.getElementById("publishAnotherBtn");
const keptImageHint = document.getElementById("keptImageHint");
const keptImagePreview = document.getElementById("keptImagePreview");
const formError = document.getElementById("formError");
const submitBtn = document.getElementById("submitBtn");

const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;

let currentId = null;
let pollTimer = null;
let lastDraft = { title: "", blurb: "", imageDataUrl: null };

function showFormError(message) {
  formError.textContent = message;
  formError.classList.remove("hidden");
}

function clearFormError() {
  formError.classList.add("hidden");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (file.size > MAX_IMAGE_BYTES) {
      return reject(new Error("התמונה גדולה מדי (עד 3.5MB). נסי תמונה קטנה יותר."));
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("לא הצלחנו לקרוא את התמונה. נסי קובץ אחר."));
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
    try {
      const res = await fetch(`/api/publish/${id}/status`);
      if (!res.ok) {
        stopPolling();
        showOnly(errorCard);
        return;
      }
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
    } catch (e) {
      // A single flaky network tick shouldn't kill the flow — the next tick tries again.
    }
  }, 700);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearFormError();

  const title = document.getElementById("title").value;
  const blurb = document.getElementById("blurb").value;
  const imageFile = document.getElementById("image").files[0];

  submitBtn.disabled = true;
  try {
    // No new file chosen? Fall back to whatever image was already attached
    // (matters for the "edit and republish" path, where the file input can't
    // be pre-filled for security reasons).
    const imageDataUrl = (await fileToDataUrl(imageFile)) || lastDraft.imageDataUrl;
    lastDraft = { title, blurb, imageDataUrl };

    showOnly(progressCard);
    setStep("building");

    const res = await fetch("/api/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, blurb, imageDataUrl }),
    });

    if (!res.ok) {
      const problem = await res.json().catch(() => ({}));
      showOnly(form);
      showFormError(problem.error || "לא הצלחנו לפרסם. בדקי את השדות ונסי שוב.");
      return;
    }

    const data = await res.json();
    currentId = data.id;
    pollStatus(currentId);
  } catch (err) {
    showOnly(form);
    showFormError(err.message || "משהו השתבש. נסי שוב.");
  } finally {
    submitBtn.disabled = false;
  }
});

retryBtn.addEventListener("click", async () => {
  showOnly(progressCard);
  setStep("building");
  try {
    await fetch(`/api/publish/${currentId}/retry`, { method: "POST" });
    pollStatus(currentId);
  } catch (e) {
    showOnly(errorCard);
  }
});

editBtn.addEventListener("click", () => {
  clearFormError();
  document.getElementById("title").value = lastDraft.title;
  document.getElementById("blurb").value = lastDraft.blurb;
  document.getElementById("image").value = "";
  if (lastDraft.imageDataUrl) {
    keptImagePreview.src = lastDraft.imageDataUrl;
    keptImageHint.classList.remove("hidden");
  } else {
    keptImageHint.classList.add("hidden");
  }
  showOnly(form);
});

publishAnotherBtn.addEventListener("click", () => {
  clearFormError();
  form.reset();
  lastDraft = { title: "", blurb: "", imageDataUrl: null };
  keptImageHint.classList.add("hidden");
  showOnly(form);
});
