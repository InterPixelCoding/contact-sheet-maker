const upload_container = document.querySelector('.upload');
const contact_sheet = document.querySelector('.contact-sheet');

const file_input = document.createElement('input');
file_input.type = 'file';
file_input.accept = '.cr2';
file_input.multiple = true;
upload_container.appendChild(file_input);

const exifr_script = document.createElement('script');
exifr_script.src = 'https://cdn.jsdelivr.net/npm/exifr/dist/full.umd.js';
document.head.appendChild(exifr_script);

const dcraw_script = document.createElement('script');
dcraw_script.src = 'https://cdn.jsdelivr.net/npm/dcraw/dist/dcraw.min.js'; // cdnjs/jsdelivr path may vary
let dcraw_ready = false;
dcraw_script.onload = () => { dcraw_ready = true; };

// Utility: show image blob and add EXIF info
// Utility: show image blob and add EXIF info
async function append_image_blob(blob, filename, file_obj) {
    const url = URL.createObjectURL(blob);

    // Create wrapper
    const wrapper = document.createElement('div');
    wrapper.classList.add('photo-thumb');

    // Create image
    const img = document.createElement('img');
    img.src = url;
    img.alt = filename;

    wrapper.appendChild(img);

    // Extract EXIF metadata
    try {
        const meta = await exifr.parse(file_obj, [
            'ExposureTime',
            'FNumber',
            'FocalLength',
        ]);

        if (meta) {
            const shutter = meta.ExposureTime
                ? (meta.ExposureTime < 1
                    ? `1/${Math.round(1 / meta.ExposureTime)}`
                    : `${meta.ExposureTime}s`)
                : '?';
            const aperture = meta.FNumber ? `f/${meta.FNumber}` : '?';
            const focal = meta.FocalLength
                ? `${Math.round(meta.FocalLength)}mm`
                : '?mm';
            wrapper.dataset.meta = `${shutter} - ${aperture} - ${focal}`;
        } else {
            wrapper.dataset.meta = 'No EXIF';
        }
    } catch (err) {
        console.warn('EXIF parse failed for', filename, err);
        wrapper.dataset.meta = 'No EXIF';
    }

    contact_sheet.appendChild(wrapper);
}



async function try_exifr_thumbnail(file) {
    if (typeof exifr === 'undefined' || !exifr.thumbnail) {
        throw new Error('exifr-thumbnail-unavailable');
    }
    // exifr.thumbnail may return blob or a data URL depending on build; handle both.
    const result = await exifr.thumbnail(file);
    // Some builds return a Blob, some return a string URL — normalize to Blob.
    if (!result) return null;

    if (result instanceof Blob) {
        return result;
    } else if (typeof result === 'string') {
        // data URL or object URL
        // if data URL, convert to blob
        if (result.startsWith('data:')) {
            const res = await fetch(result);
            return await res.blob();
        }
        // object URL, fetch and convert
        try {
            const res = await fetch(result);
            return await res.blob();
        } catch (err) {
            // fallback: create image element with that src, but return null
            return null;
        }
    } else {
        return null;
    }
}

async function try_dcraw_thumbnail(file) {
    // lazy-load dcraw script if needed
    if (!dcraw_ready) {
        // attach to document now and await load
        document.head.appendChild(dcraw_script);
        await new Promise((resolve, reject) => {
            dcraw_script.onload = () => { dcraw_ready = true; resolve(); };
            dcraw_script.onerror = () => reject(new Error('Failed to load dcraw.js'));
        });
    }

    // read file as ArrayBuffer -> Uint8Array
    const array_buffer = await file.arrayBuffer();
    const u8 = new Uint8Array(array_buffer);

    // dcraw is a function exported to global scope by the bundle
    if (typeof dcraw === 'undefined') {
        throw new Error('dcraw-not-available');
    }

    // call dcraw with extractThumbnail option
    // dcraw(u8, { extractThumbnail: true }) may return:
    // - an object with thumbnail data or a Uint8Array / buffer (depends on build)
    let result;
    try {
        result = dcraw(u8, { extractThumbnail: true });
    } catch (err) {
        throw err;
    }

    // dcraw(js) may return a Uint8Array or object. Attempt to detect thumbnail bytes.
    if (!result) return null;

    // If result is a Uint8Array that represents JPEG bytes, convert to Blob:
    if (result instanceof Uint8Array) {
        return new Blob([result.buffer], { type: 'image/jpeg' });
    }

    // Some implementations return an object; try common shapes:
    if (result.thumb && result.thumb.data instanceof Uint8Array) {
        return new Blob([result.thumb.data.buffer], { type: 'image/jpeg' });
    }

    // If result is a string (some builds output base64/data), try to convert:
    if (typeof result === 'string') {
        if (result.startsWith('data:')) {
            const fetched = await fetch(result);
            return await fetched.blob();
        } else {
            // not a data URL; give up
            return null;
        }
    }

    // unknown shape
    return null;
}

exifr_script.onload = () => {
    file_input.addEventListener('change', async (event) => {
        const files = Array.from(event.target.files);
        contact_sheet.innerHTML = '';

        for (const file of files) {
            try {
                // first attempt exifr (fast)
                let thumb_blob = null;
                try {
                    thumb_blob = await try_exifr_thumbnail(file);
                } catch (err) {
                    console.warn('exifr failed for', file.name, err && err.message ? err.message : err);
                    thumb_blob = null;
                }

                // if exifr didn't yield a thumbnail, fallback to dcraw
                if (!thumb_blob) {
                    try {
                        thumb_blob = await try_dcraw_thumbnail(file);
                    } catch (err) {
                        console.error('dcraw fallback failed for', file.name, err && err.message ? err.message : err);
                        thumb_blob = null;
                    }
                }

                if (thumb_blob) {
                    append_image_blob(thumb_blob, file.name, file);
                } else {
                    // final fallback: show filename placeholder
                    const placeholder = document.createElement('div');
                    placeholder.textContent = 'No thumbnail: ' + file.name;
                    placeholder.style.color = '#eee';
                    placeholder.style.padding = '10px';
                    placeholder.style.margin = '10px';
                    placeholder.style.fontSize = '14px';
                    contact_sheet.appendChild(placeholder);
                    console.warn('No thumbnail found for', file.name);
                }
            } catch (err) {
                console.error(`Error reading ${file.name}:`, err);
            }
        }

        selection_logic();
    });
};

exifr_script.onerror = () => {
    console.error('Failed to load exifr. Without exifr the pipeline may still try dcraw fallback.');
};

function selection_logic() {
    Array.from(document.querySelectorAll(".contact-sheet > .photo-thumb")).forEach(img => {
        img.onclick = () => {
            img.classList.toggle("fullscreen");
        }
        img.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            img.remove();
        })
    })
}
