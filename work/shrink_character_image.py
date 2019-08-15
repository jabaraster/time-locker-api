import cv2
import glob
import os

base_dir = "../../../save/Time Locker/"
src_dir = "model-proccesed/"
dst_dir = "result/"

def build_path(path, img):
    height, width = src.shape[:2]
    ret = base_dir + dst_dir + os.path.split(os.path.splitext(path)[0])[1] + "@" + str(width) + "x" + str(height) + ".png"
    print(ret)
    return ret

def write_image(originalPath, img):
    height, width = img.shape[:2]
    path = base_dir + dst_dir + os.path.split(os.path.splitext(originalPath)[0])[1] + "@" + str(width) + "x" + str(height) + ".png"
    print(path)
    cv2.imwrite(path, img)

def clip_image(img, position, size):
    return img[position[1]:position[1]+size[1], position[0]:position[0]+size[0]]

for path in glob.glob(base_dir + src_dir + "/*.png"):
    print(path)
    src = cv2.imread(path)
  
    # original size.
    write_image(path, src)
  
    # clip vertical
    orgHeight, orgWidth = src.shape[:2]
    clipX = 2
    clipY = 40
    clipped = clip_image(src, position=[clipX, clipY], size=[orgWidth - clipX * 2, orgHeight - clipY])
    write_image(path, clipped)

    # half size
    clippedHeight, clippedWidth = clipped.shape[:2]
    write_image(path, cv2.resize(clipped, (int(clippedWidth / 2), int(clippedHeight / 2))))
    
    # quater size
    write_image(path, cv2.resize(clipped, (int(clippedWidth / 4), int(clippedHeight / 4))))

    # vertical 130
    small = cv2.resize(clipped, (130, int(130 / clippedWidth * clippedHeight)))
    write_image(path, small)

    # character only
    write_image(path, clip_image(small, position=[0, 0], size=[65, 65]))