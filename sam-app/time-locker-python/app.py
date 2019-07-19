import json
import base64
import tempfile
import cv2
import glob
import os
import boto3

ARMAMENTS_X = 780
ARMAMENTS_Y = 1200
ARMAMENTS_WIDTH = 280
ARMAMENTS_HEIGHT = 400

ARMAMENTS = ["BEAM",
             "GUARD_BIT",
             "HOMING_SHOT",
             "ICE_CANON",
             "LINE",
             "MINE_BOT",
             "MISSILE",
             "ROCKET",
             "SIDE_SHOT",
             "SUPPORTER",
             "TWIN_SHOT",
             "WIDE_SHOT",
             ]

def extract_armaments(event, context):
    imageData = base64.b64decode(event["dataInBase64"])

    with tempfile.NamedTemporaryFile("wb") as f:
        f.write(imageData)
        ret = proc(f.name)
        return {
            "statusCode": 200,
            "body": json.dumps(ret),
        }

def proc(imageFilePath):
    img = clip_armament_part(cv2.imread(imageFilePath, cv2.IMREAD_GRAYSCALE))
    w_, h_ = img.shape[::-1]
    results= {
        "armaments": {}
    }

    min_top = 100000
    for arm in ARMAMENTS:
        template = cv2.imread("./key-image/ARM_" + arm + ".png", cv2.IMREAD_GRAYSCALE)
        w, h = template.shape[::-1]
        res = cv2.matchTemplate(img, template, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(res)
        if (min_top > max_loc[1]):
            min_top = max_loc[1]

        if (max_val > 0.9):
            cv2.rectangle(img, max_loc, (max_loc[0] + w, max_loc[1] + h), color=(0, 0, 0), thickness=-1) # 次のフェイズ(=数値の抽出)の邪魔になる箇所を塗り潰す.
            results["armaments"][arm] = {
                "boundingBox": {
                    "Left": max_loc[0],
                    "Top": max_loc[1],
                    "width": w,
                    "height": h
                }
            }
    # 武装が描画されていないエリアを極力塗り潰す.
    if (min_top > 10):
        cv2.rectangle(img, (0,0), (ARMAMENTS_WIDTH, min_top - 10), color=(0 ,0 ,0), thickness=-1)
    results["imageForLevelRekognition"] = {
        "width": ARMAMENTS_WIDTH,
        "height": ARMAMENTS_HEIGHT,
        "dataInBase64": to_png_in_base64(img),
    }
    return results

def to_png_in_base64(img):
    with tempfile.NamedTemporaryFile("w", suffix=".png") as f:
        cv2.imwrite(f.name, img)
        data = open(f.name, "rb").read()
        return base64.b64encode(data).decode()

def clip_armament_part(img):
    return clip_image(img, size=[ARMAMENTS_WIDTH, ARMAMENTS_HEIGHT], position=[ARMAMENTS_X, ARMAMENTS_Y])

def clip_image(img, position, size):
    return img[position[1]:position[1]+size[1], position[0]:position[0]+size[0]]

if __name__ == '__main__':
    c = open("../../nogit/miss.jpg", "rb").read()
    res = extract_armaments({"dataInBase64":base64.b64encode(c).decode("UTF-8")}, {})
    # res = proc("../../nogit/screen-shot.jpg")
    print(json.loads(res["body"])["imageForLevelRekognition"]["dataInBase64"])
    exit(0)