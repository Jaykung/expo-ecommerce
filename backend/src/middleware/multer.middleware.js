import multer, { } from "multer";
import path, { } from "path";

const storage = multer.diskStorage({
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

// file filter: jpeg, jpg, png, webp
const fileFilter = (req, file, cb) => {
  const allowTypes = /jpeg|jpg|png|webp/;
  const extname = allowTypes.test(path.extname(file.originalname).toLocaleLowerCase());
  const mimeType = allowTypes.test(file.mimeType);

  if (extname && mimeType) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed (jpeg,jpg,png,web)"));
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});