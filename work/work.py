import cv2
import glob
import os

base_dir = "../../../save/Time Locker/"
src_dir = base_dir + "model/"
dst_dir = base_dir + "clipped/"

def clip_image(img, position, size):
  return img[position[1]:position[1]+size[1], position[0]:position[0]+size[0]]

for path in glob.glob(src_dir + "/*.png"):
  print(path)
  img = clip_image(cv2.imread(path), position=[33, 1585], size=[650, 440])
  orgHeight, orgWidth = img.shape[:2]
  size = (int(orgWidth/2), int(orgHeight/2))
  print(size)
  cv2.imwrite(dst_dir + os.path.split(os.path.splitext(path)[0] + ".png")[1], cv2.resize(img, size))
