const form = document.getElementById("publishForm");
const progressCard = document.getElementById("progressCard");
const successCard = document.getElementById("successCard");
const errorCard = document.getElementById("errorCard");
const retryBtn = document.getElementById("retryBtn");
const editBtn = document.getElementById("editBtn");
const publishAnotherBtn = document.getElementById("publishAnotherBtn");
const imageInput = document.getElementById("image");
const imagePreviewBox = document.getElementById("imagePreviewBox");
const imagePreview = document.getElementById("imagePreview");
const imagePreviewCaption = document.getElementById("imagePreviewCaption");
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
      return reject(new Error("התמונה גדולה מדי (עד 3.5MB). כדאי לבחור תמונה קטנה יותר."));
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("לא הצלחנו לקרוא את הקובץ. אפשר לנסות קובץ אחר."));
    reader.readAsDataURL(file);
  });
}

function hideImagePreview() {
  imagePreviewBox.classList.add("hidden");
  imagePreview.src = "";
  imagePreviewCaption.textContent = "";
}

function showImagePreview(url, caption) {
  imagePreview.src = url;
  imagePreviewCaption.textContent = caption || "";
  imagePreviewBox.classList.remove("hidden");
}

// One preview, two ways to get an image into it: a file just chosen in the
// input, or (during "edit and republish" after a failure) the image from
// the previous attempt, which a browser can't silently put back in a file
// input on its own.
async function refreshImagePreview() {
  const file = imageInput.files[0];
  if (file) {
    try {
      showImagePreview(await fileToDataUrl(file), "");
    } catch (e) {
      hideImagePreview(); // the real error surfaces on submit instead
    }
  } else if (lastDraft.imageDataUrl) {
    showImagePreview(lastDraft.imageDataUrl, "התמונה הזו תישמר אם לא ייבחר קובץ חדש");
  } else {
    hideImagePreview();
  }
}

imageInput.addEventListener("change", refreshImagePreview);

// Coming back to this screen via the browser's back/forward button restores
// the page from bfcache with whatever JS state it had before — stale form
// values, a stray image preview, maybe a finished progress bar. Landing here
// any other way than the in-app "edit" flow should start clean.
function resetToFreshForm() {
  stopPolling();
  form.reset();
  lastDraft = { title: "", blurb: "", imageDataUrl: null };
  clearFormError();
  hideImagePreview();
  showOnly(form);
}

window.addEventListener("pageshow", (event) => {
  if (event.persisted) resetToFreshForm();
});

// Landing here fresh always starts clean too — some browsers restore old
// input values on a plain back-navigation reload even without bfcache,
// independently of any of the app's own state.
resetToFreshForm();

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
      showFormError(problem.error || "לא הצלחנו לפרסם. כדאי לבדוק את השדות ולנסות שוב.");
      return;
    }

    const data = await res.json();
    currentId = data.id;
    pollStatus(currentId);
  } catch (err) {
    showOnly(form);
    showFormError(err.message || "משהו השתבש. אפשר לנסות שוב.");
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
  imageInput.value = "";
  refreshImagePreview();
  showOnly(form);
});

publishAnotherBtn.addEventListener("click", resetToFreshForm);
