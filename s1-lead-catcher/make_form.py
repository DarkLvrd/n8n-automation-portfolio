import json, uuid
B=[]
def u(): return str(uuid.uuid4())
def add(t, gt, payload, g=None):
    x=u(); B.append({"uuid":x,"type":t,"groupUuid":g or x,"groupType":gt,"payload":payload}); return x
add("FORM_TITLE","FORM_TITLE",{"html":"Book a visit — Pelvane Dental","title":"Book a visit — Pelvane Dental"})
add("TEXT","TEXT",{"html":"Tell us what's going on and we'll get back to you within minutes. <em>(Concept demo — Pelvane Dental is a fictional clinic.)</em>"})
def q(title, t, payload):
    add("TITLE","QUESTION",{"html":title})
    add(t,t,payload)
q("Full name","INPUT_TEXT",{"isRequired":True,"placeholder":"Jane Doe"})
q("Email","INPUT_EMAIL",{"isRequired":True,"placeholder":"jane@example.com"})
q("Phone","INPUT_PHONE_NUMBER",{"isRequired":False})
q("What can we help with?","TEXTAREA",{"isRequired":True,"placeholder":"e.g. My back tooth hurts when I drink something cold"})
def choice(title, opts):
    add("TITLE","QUESTION",{"html":title})
    g=u()
    for i,o in enumerate(opts):
        add("MULTIPLE_CHOICE_OPTION","MULTIPLE_CHOICE",{"index":i,"isFirst":i==0,"isLast":i==len(opts)-1,"isRequired":True,"text":o},g)
choice("How soon do you need to be seen?",["Today — it's urgent","This week","Within a month","Just exploring"])
choice("Do you have dental insurance?",["Yes","No","Not sure"])
print(json.dumps({"status":"PUBLISHED","blocks":B}))
